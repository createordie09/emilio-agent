import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_ROLES,
  AppError,
  defaultBrief,
  type Brief,
  type BriefDraft,
  type OutlineNodeView,
  type PlanOverview,
} from '@emilio/shared';
import {
  EngineService,
  HashEmbedder,
  MockLlmClient,
  researchMockRespond,
  planningMockRespond,
  writingMockRespond,
  juryMockRespond,
  computeNumbering,
  allocateWords,
  mergeProposal,
  estimateMission,
  projectRemaining,
  loadStructures,
  loadEstimation,
  loadPlanConfig,
  DEFAULT_ESTIMATION,
  type DraftNode,
  type PlanOutput,
} from '../src';

const RES = join(__dirname, '../../../resources');

function mk(over: { brief?: BriefDraft } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'emilio-p-'));
  const mock = new MockLlmClient({
    delayMs: 0,
    costPerCallUsd: 0.002,
    respond: (r) =>
      researchMockRespond(r) ??
      planningMockRespond(r) ??
      writingMockRespond(r) ??
      juryMockRespond(r),
  });
  const engine = new EngineService({
    dbPath: join(dir, 'e.db'),
    dataDir: dir,
    embedder: new HashEmbedder(),
    mock,
    presetsPath: join(RES, 'presets.json'),
    normsProfilesPath: join(RES, 'norms-profiles.json'),
    qualityWeightsPath: join(RES, 'quality-weights.json'),
    resourcesDir: RES,
    runner: { tickMs: 5 },
  });
  const brief: BriefDraft = {
    ...defaultBrief('memoire_master'),
    discipline: 'Sciences de gestion',
    titre: 'Microfinance et inclusion financière au Bénin',
    problematique: 'Dans quelle mesure la microfinance améliore-t-elle l’inclusion financière ?',
    approche: 'documentaire',
    hypotheses: ['H1 : la microfinance augmente l’accès au crédit.'],
    motsCles: ['microfinance', 'inclusion financière'],
    execution: { ...defaultBrief().execution!, preset: 'equilibre', budgetMaxUsd: 12 },
    profilNormesId: 'afrique-francophone-standard',
    ...over.brief,
  };
  return { engine, mock, dir, brief };
}

/** Brouillon → mission au stade « brief » en mode simulé. */
async function briefed(over: { brief?: BriefDraft } = {}) {
  const t = mk(over);
  const d = t.engine.drafts.create({ workType: t.brief.workType });
  t.engine.drafts.save(d.id, t.brief);
  await t.engine.drafts.finalize(d.id, { confirmNoFieldData: true });
  const r = await t.engine.handle('setLlmMode', { id: d.id, simulated: true });
  expect(r.ok).toBe(true);
  return { ...t, id: d.id };
}
const plan = async (e: EngineService, id: string): Promise<PlanOverview> => {
  const r = await e.handle('getPlan', { id });
  if (!r.ok) throw new Error(r.error.messageFr);
  return r.value as PlanOverview;
};
const generate = async (e: EngineService, id: string) => {
  const r = await e.handle('generatePlan', { id });
  expect(r.ok).toBe(true);
  await e.planning.idle();
};

const N = (o: Partial<DraftNode> & { title: string }): DraftNode => ({
  key: null,
  level: 'section',
  kind: 'corps',
  objective: '',
  keyQuestions: [],
  weight: null,
  sourceIds: [],
  remarks: null,
  children: [],
  ...o,
});

describe('plan : numérotation et répartition des mots', () => {
  const v = (
    id: string,
    parentId: string | null,
    ordinal: number,
    level: OutlineNodeView['level'],
    kind: OutlineNodeView['kind'] = 'corps',
  ): OutlineNodeView => ({
    id,
    parentId,
    ordinal,
    level,
    kind,
    numbering: null,
    title: id,
    objective: '',
    keyQuestions: [],
    targetWords: 0,
    requiredSourcesMin: 0,
    sourceIds: [],
    remarks: null,
    templateKey: null,
  });
  it('parties en romains, chapitres en continu à travers les parties, sections et sous-sections hiérarchiques ; intro/conclusion non numérotées', () => {
    const nums = computeNumbering([
      v('intro', null, 0, 'chapitre', 'introduction'),
      v('p1', null, 1, 'partie'),
      v('c1', 'p1', 2, 'chapitre'),
      v('c1s1', 'c1', 3, 'section'),
      v('c1s1a', 'c1s1', 4, 'sous_section'),
      v('c2', 'p1', 5, 'chapitre'),
      v('p2', null, 6, 'partie'),
      v('c3', 'p2', 7, 'chapitre'),
      v('c3s1', 'c3', 8, 'section'),
      v('c3s2', 'c3', 9, 'section'),
      v('concl', null, 10, 'chapitre', 'conclusion'),
    ]);
    expect(Object.fromEntries(nums)).toEqual({
      intro: null,
      p1: 'I',
      c1: '1',
      c1s1: '1.1',
      c1s1a: '1.1.1',
      c2: '2',
      p2: 'II',
      c3: '3',
      c3s1: '3.1',
      c3s2: '3.2',
      concl: null,
    });
  });
  it('sections directement sous une partie (rapport de stage) : « 1.1 », « 2.1 »', () => {
    const nums = computeNumbering([
      v('p1', null, 0, 'partie'),
      v('a', 'p1', 1, 'section'),
      v('p2', null, 2, 'partie'),
      v('b', 'p2', 3, 'section'),
    ]);
    expect(nums.get('a')).toBe('1.1');
    expect(nums.get('b')).toBe('2.1');
  });
  it('la somme des mots est exacte, proportionnelle aux poids ; les sections sans poids reçoivent la moyenne', () => {
    const a = N({ title: 'a', weight: 3 });
    const b = N({ title: 'b', weight: 1 });
    const c = N({ title: 'c' });
    const roots = [a, b, c];
    const w = allocateWords(roots, 10_000);
    const sum = roots.reduce((s, n) => s + (w.get(n) ?? 0), 0);
    expect(sum).toBe(10_000);
    expect(w.get(a)!).toBeGreaterThan(w.get(b)!);
    expect(w.get(c)).toBeGreaterThan(0);
  });
  it('les mots d’un nœud avec enfants se répartissent entre ses enfants', () => {
    const k1 = N({ title: 'k1', weight: 1 });
    const k2 = N({ title: 'k2', weight: 1 });
    const parent = N({ title: 'p', weight: 1, children: [k1, k2] });
    const w = allocateWords([parent], 4000);
    expect(w.get(k1)! + w.get(k2)!).toBe(w.get(parent));
  });
});

describe('gabarit de structure imposé (§15.3)', () => {
  const tpl = loadStructures(RES).find((t) => t.id === 'memoire-recherche')!;
  const out = (noeuds: PlanOutput['noeuds']): PlanOutput => ({
    noeuds,
    justification_globale: '',
    methodologie: '',
    hypotheses: [],
    risques: [],
    manques: [],
  });
  const n = (
    ref: string,
    parent: string | null,
    titre: string,
    cle?: string,
    niveau: 'partie' | 'chapitre' | 'section' | 'sous_section' = 'section',
  ): PlanOutput['noeuds'][number] => ({
    ref,
    parent,
    cle,
    niveau,
    titre,
    objectif: '',
    questions_cles: [],
    mots_cibles: 0,
    sources: [],
  });
  it('les six gabarits existent, un par type de travail', () => {
    const all = loadStructures(RES);
    expect(all.map((t) => t.id).sort()).toEqual([
      'article-imrad',
      'memoire-recherche',
      'rapport-professionnel',
      'rapport-stage',
      'revue-litterature',
      'these-chapitres',
    ]);
  });
  it('restaure les nœuds du gabarit absents et écarte les chapitres ajoutés par le modèle', () => {
    const { roots, notes } = mergeProposal(
      out([
        n('1', null, 'Introduction', 'intro', 'chapitre'),
        n('2', null, 'Un chapitre inventé', undefined, 'chapitre'),
        n('3', '2', 'Une section du chapitre inventé'),
      ]),
      tpl,
      true,
    );
    const keys = (l: DraftNode[]): string[] => l.flatMap((x) => [x.key ?? '', ...keys(x.children)]);
    const all = keys(roots);
    for (const k of ['intro', 'p1', 'c1', 'c2', 'p2', 'c3', 'c4', 'concl'])
      expect(all).toContain(k);
    expect(roots.map((r) => r.title)).not.toContain('Un chapitre inventé');
    // la section du chapitre écarté remonte au lieu d'être perdue
    expect(JSON.stringify(roots)).toContain('Une section du chapitre inventé');
    expect(notes.some((x) => x.includes('écarté'))).toBe(true);
    expect(notes.some((x) => x.includes('restaurée'))).toBe(true);
  });
  it('structure personnalisée : aucun nœud imposé ni restauré', () => {
    const { roots } = mergeProposal(
      out([n('1', null, 'Mon plan', undefined, 'chapitre')]),
      tpl,
      false,
    );
    expect(roots).toHaveLength(1);
  });
});

describe('estimation du coût et de la durée (§14.5)', () => {
  const brief = (over: Partial<Brief> = {}) =>
    ({
      ...(defaultBrief('memoire_master') as Brief),
      hypotheses: ['H1', 'H2'],
      ...over,
    }) as Brief;
  const nodes = (): OutlineNodeView[] =>
    ['A', 'B', 'C', 'D'].map((t, i) => ({
      id: t,
      parentId: null,
      ordinal: i,
      level: 'chapitre' as const,
      kind: 'corps' as const,
      numbering: String(i + 1),
      title: t,
      objective: '',
      keyQuestions: [],
      targetWords: 4000,
      requiredSourcesMin: 3,
      sourceIds: [],
      remarks: null,
      templateKey: null,
    }));
  const models = Object.fromEntries(AGENT_ROLES.map((r) => [r, 'vendor/m'])) as Record<
    string,
    string
  >;
  const base = {
    nodes: nodes(),
    brief: brief(),
    models,
    price: () => ({ prompt: 3e-6, completion: 15e-6 }),
    speed: () => null,
    cfg: DEFAULT_ESTIMATION,
    simulated: false,
    hasFieldData: false,
    spentUsd: 0.1,
    budgetMaxUsd: 50,
    now: () => '2026-10-03T00:00:00.000Z',
  };
  it('trois scénarios croissants (bas ≤ moyen ≤ haut), coût et durée positifs', () => {
    const e = estimateMission(base);
    expect(e.scenarios.bas.costUsd).toBeGreaterThan(0);
    expect(e.scenarios.bas.costUsd).toBeLessThanOrEqual(e.scenarios.moyen.costUsd);
    expect(e.scenarios.moyen.costUsd).toBeLessThanOrEqual(e.scenarios.haut.costUsd);
    expect(e.scenarios.bas.durationSec).toBeLessThanOrEqual(e.scenarios.haut.durationSec);
    expect(e.partial).toBe(false);
    expect(e.targetWords).toBe(16000);
    expect(e.sectionCount).toBe(4);
    const sum = e.phases.reduce((s, p) => s + p.costUsd.moyen, 0);
    expect(sum).toBeCloseTo(e.scenarios.moyen.costUsd, 2);
  });
  it('la rédaction suit M × 1,3 jetons/mot : doubler les mots double les jetons de sortie', () => {
    const one = estimateMission(base);
    const two = estimateMission({
      ...base,
      nodes: nodes().map((n) => ({ ...n, targetWords: 8000 })),
    });
    const out = (e: typeof one) => e.phases.find((p) => p.phase === 'P5')!.tokensOut;
    expect(out(two) / out(one)).toBeGreaterThan(1.8);
  });
  it('P4 seulement avec des données de terrain ; PPTX seulement si demandé', () => {
    const e1 = estimateMission(base);
    expect(e1.phases.find((p) => p.phase === 'P4')).toBeUndefined();
    expect(e1.phases.find((p) => p.phase === 'P9')).toBeUndefined();
    const e2 = estimateMission({
      ...base,
      hasFieldData: true,
      brief: brief({ livrables: { ...defaultBrief().livrables!, pptx: true } }),
    });
    expect(e2.phases.find((p) => p.phase === 'P4')).toBeDefined();
    expect(e2.phases.find((p) => p.phase === 'P9')).toBeDefined();
  });
  it('modèle sans prix connu : estimation partielle, signalée', () => {
    const e = estimateMission({ ...base, price: () => null });
    expect(e.partial).toBe(true);
    expect(e.missingPrice).toEqual(['vendor/m']);
    expect(e.scenarios.moyen.costUsd).toBe(0);
  });
  it('mode simulé : prix d’exemple de la configuration, marqué comme tel', () => {
    const e = estimateMission({ ...base, simulated: true, price: () => null });
    expect(e.simulated).toBe(true);
    expect(e.partial).toBe(false);
    expect(e.scenarios.moyen.costUsd).toBeGreaterThan(0);
  });
  it('dépassement du budget signalé par scénario (dépenses déjà faites incluses)', () => {
    const e = estimateMission({ ...base, budgetMaxUsd: 0.5 });
    expect(e.exceedsBudget).toEqual({ bas: true, moyen: true, haut: true });
    const big = estimateMission({ ...base, budgetMaxUsd: 10_000 });
    expect(big.exceedsBudget).toEqual({ bas: false, moyen: false, haut: false });
  });
  it('plus d’agents en parallèle → durée plus courte, coût identique', () => {
    const slow = estimateMission({
      ...base,
      brief: brief({ execution: { ...base.brief.execution!, parallelism: 1 } }),
    });
    const fast = estimateMission({
      ...base,
      brief: brief({ execution: { ...base.brief.execution!, parallelism: 4 } }),
    });
    expect(fast.scenarios.moyen.durationSec).toBeLessThan(slow.scenarios.moyen.durationSec);
    expect(fast.scenarios.moyen.costUsd).toBe(slow.scenarios.moyen.costUsd);
  });
  it('coût restant projeté : seulement les phases non terminées', () => {
    const e = estimateMission(base);
    const all = projectRemaining(e, 'moyen', []);
    const rest = projectRemaining(e, 'moyen', ['P3', 'P4']);
    expect(all.remainingUsd).toBeCloseTo(e.scenarios.moyen.costUsd, 2);
    expect(rest.remainingUsd).toBeLessThan(all.remainingUsd);
  });
  it('fichiers de configuration : lus s’ils existent, valeurs par défaut sinon', () => {
    expect(loadEstimation(RES).tokensPerWord).toBe(1.3);
    expect(loadPlanConfig(undefined).minSectionWords).toBe(400);
    expect(loadStructures(undefined)).toEqual([]);
  });
});

describe('P1 + P2 : cadrage et plan (mode simulé)', () => {
  it('génère le plan : cadrage, sources exploratoires vérifiées, structure imposée, mots exacts, numérotation, estimation', async () => {
    const { engine, id } = await briefed();
    expect(engine.missions.status(id)).toBe('briefing');
    await generate(engine, id);
    const p = await plan(engine, id);
    expect(p.status).toBe('awaiting_plan_validation');
    expect(p.version).toBe(1);

    // P1
    expect(p.cadrage?.concepts.length).toBeGreaterThan(0);
    expect(p.cadrage?.nbRequetes).toBeGreaterThan(0);

    // P2 : sources exploratoires, jamais rejetées
    expect(p.exploratory.length).toBeGreaterThan(0);
    expect(p.exploratory.every((s) => s.verificationStatus !== 'rejected')).toBe(true);

    // Structure imposée (mémoire) : toutes les clés du gabarit
    const keys = p.nodes.map((n) => n.templateKey);
    for (const k of ['intro', 'p1', 'c1', 'c2', 'p2', 'c3', 'c4', 'concl'])
      expect(keys).toContain(k);
    expect(p.nodes.filter((n) => n.level === 'chapitre' && n.kind === 'corps')).toHaveLength(4);

    // Numérotation
    const byKey = Object.fromEntries(
      p.nodes.filter((n) => n.templateKey).map((n) => [n.templateKey!, n]),
    );
    expect(byKey.p1!.numbering).toBe('I');
    expect(byKey.c1!.numbering).toBe('1');
    expect(byKey.c3!.numbering).toBe('3');
    expect(byKey.intro!.numbering).toBeNull();
    const sec = p.nodes.find((n) => n.parentId === byKey.c1!.id)!;
    expect(sec.numbering).toBe('1.1');

    // Mots : somme des feuilles = cible (60–90 pages × 350 × 0,85 → milieu)
    const leafSum = p.words.planned;
    expect(leafSum).toBe(Math.round((((60 + 90) / 2) * 350 * 0.85) / 10) * 10);
    expect(p.words.status).toBe('ok');

    // Sources pressenties : uniquement des sources de la liste exploratoire
    const known = new Set(p.exploratory.map((s) => s.id));
    const pressenties = p.nodes.flatMap((n) => n.sourceIds);
    expect(pressenties.length).toBeGreaterThan(0);
    expect(pressenties.every((x) => known.has(x))).toBe(true);

    // Estimation (simulée)
    expect(p.estimate?.simulated).toBe(true);
    expect(p.estimate!.scenarios.haut.costUsd).toBeGreaterThanOrEqual(
      p.estimate!.scenarios.bas.costUsd,
    );
    expect(p.liminaires).toContain('Page de garde');

    // Journal en français
    const events = engine.journal.list(id, 100).map((e) => e.messageFr);
    expect(events.some((m) => m.startsWith('Directeur de recherche : cadrage terminé'))).toBe(true);
    expect(events.some((m) => m.startsWith('Architecte du plan : plan proposé'))).toBe(true);
    await engine.close();
  });

  it('un brief sans hypothèse produit une incohérence signalée à l’utilisateur', async () => {
    const { engine, id } = await briefed({ brief: { hypotheses: [] } });
    await generate(engine, id);
    const p = await plan(engine, id);
    expect(p.cadrage?.incoherences.length).toBe(1);
    expect(p.warnings.some((w) => w.includes('incohérence'))).toBe(true);
    await engine.close();
  });

  it('problématique à proposer : trois formulations, choix obligatoire avant validation', async () => {
    const { engine, id } = await briefed({
      brief: { problematique: undefined, problematiqueAProposer: true },
    });
    await generate(engine, id);
    const p = await plan(engine, id);
    expect(p.problematiqueAProposer).toBe(true);
    expect(p.cadrage?.problematiques).toHaveLength(3);
    const r = await engine.handle('validatePlan', { id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail ?? r.error.messageFr).toContain('problématique');
    expect(engine.missions.status(id)).toBe('awaiting_plan_validation');
    await engine.close();
  });

  it('structure personnalisée : le gabarit n’est qu’indicatif', async () => {
    const { engine, id } = await briefed({ brief: { structure: { mode: 'personnalisee' } } });
    await generate(engine, id);
    const p = await plan(engine, id);
    expect(p.nodes.length).toBeGreaterThan(0);
    await engine.close();
  });

  it('autres types de travail : rapport de stage (parties → sections), article IMRaD', async () => {
    const stage = await briefed({
      brief: { workType: 'rapport_stage', longueur: defaultBrief('rapport_stage').longueur },
    });
    await generate(stage.engine, stage.id);
    const p = await plan(stage.engine, stage.id);
    const part = p.nodes.find((n) => n.templateKey === 'p1')!;
    expect(part.level).toBe('partie');
    expect(p.nodes.find((n) => n.parentId === part.id)?.numbering).toBe('1.1');
    await stage.engine.close();
    const art = await briefed({
      brief: { workType: 'article', longueur: defaultBrief('article').longueur },
    });
    await generate(art.engine, art.id);
    const a = await plan(art.engine, art.id);
    expect(a.nodes.map((n) => n.title)).toEqual([
      'Introduction',
      'Méthodes',
      'Résultats',
      'Discussion',
    ]);
    expect(a.nodes.map((n) => n.numbering)).toEqual(['1', '2', '3', '4']);
    await art.engine.close();
  });

  it('refuse de générer hors du stade « brief » ou avec un brief invalide', async () => {
    const { engine } = mk();
    const r = await engine.handle('createDemoMission', {});
    expect(r.ok).toBe(true);
    const demo = (r as { value: { id: string } }).value.id;
    const bad = await engine.handle('generatePlan', { id: demo });
    expect(bad.ok).toBe(false);
    await engine.close();
  });
});

describe('édition du plan (§6.5)', () => {
  const ready = async () => {
    const t = await briefed();
    await generate(t.engine, t.id);
    return t;
  };
  const call = async <T>(
    e: EngineService,
    m: Parameters<EngineService['handle']>[0],
    p: object,
  ) => {
    const r = await e.handle(m, p);
    return r as
      { ok: true; value: T } | { ok: false; error: { messageFr: string; detail?: string } };
  };

  it('renomme, modifie objectif, questions, mots et nombre minimal de sources', async () => {
    const { engine, id } = await ready();
    const p = await plan(engine, id);
    const node = p.nodes.find((n) => n.templateKey === 'c1')!;
    const r = await call<PlanOverview>(engine, 'updatePlanNode', {
      id,
      nodeId: node.id,
      patch: {
        title: 'Cadre conceptuel',
        objective: 'Définir les concepts.',
        keyQuestions: ['Q1', ' ', 'Q2'],
        targetWords: 3000,
        requiredSourcesMin: 5,
      },
    });
    expect(r.ok).toBe(true);
    const n2 = (r as { value: PlanOverview }).value.nodes.find((n) => n.id === node.id)!;
    expect(n2).toMatchObject({
      title: 'Cadre conceptuel',
      objective: 'Définir les concepts.',
      keyQuestions: ['Q1', 'Q2'],
    });
    const bad = await call(engine, 'updatePlanNode', {
      id,
      nodeId: node.id,
      patch: { title: ' ' },
    });
    expect(bad.ok).toBe(false);
    await engine.close();
  });

  it('ajoute, déplace (glisser-déposer) et supprime ; la numérotation suit ; les niveaux sont recalculés', async () => {
    const { engine, id } = await ready();
    let p = await plan(engine, id);
    const c2 = p.nodes.find((n) => n.templateKey === 'c2')!;
    const added = await call<PlanOverview>(engine, 'addPlanNode', {
      id,
      input: { parentId: c2.id, title: 'Éthique de l’enquête', index: 0 },
    });
    expect(added.ok).toBe(true);
    p = (added as { value: PlanOverview }).value;
    const mine = p.nodes.find((n) => n.title === 'Éthique de l’enquête')!;
    expect(mine.numbering).toBe('2.1');
    expect(mine.level).toBe('section');
    // la section suivante est décalée
    expect(p.nodes.filter((n) => n.parentId === c2.id)[1]!.numbering).toBe('2.2');

    // Déplacer la section vers le chapitre 1, en première position
    const c1 = p.nodes.find((n) => n.templateKey === 'c1')!;
    const moved = await call<PlanOverview>(engine, 'movePlanNode', {
      id,
      nodeId: mine.id,
      parentId: c1.id,
      index: 0,
    });
    expect(moved.ok).toBe(true);
    p = (moved as { value: PlanOverview }).value;
    expect(p.nodes.find((n) => n.id === mine.id)!.numbering).toBe('1.1');

    // Un chapitre glissé sous un autre chapitre devient une section (et ses sections des sous-sections)
    const c4 = p.nodes.find((n) => n.templateKey === 'c4')!;
    const c3 = p.nodes.find((n) => n.templateKey === 'c3')!;
    const m2 = await call<PlanOverview>(engine, 'movePlanNode', {
      id,
      nodeId: c4.id,
      parentId: c3.id,
      index: 0,
    });
    expect(m2.ok).toBe(true);
    p = (m2 as { value: PlanOverview }).value;
    expect(p.nodes.find((n) => n.id === c4.id)!.level).toBe('section');
    const sub = p.nodes.find((n) => n.parentId === c4.id);
    if (sub) expect(sub.level).toBe('sous_section');

    // Suppression
    const del = await call<PlanOverview>(engine, 'deletePlanNode', { id, nodeId: mine.id });
    expect(del.ok).toBe(true);
    p = (del as { value: PlanOverview }).value;
    expect(p.nodes.find((n) => n.id === mine.id)).toBeUndefined();
    // La suppression d'une section du gabarit est signalée
    const del2 = await call<PlanOverview>(engine, 'deletePlanNode', { id, nodeId: c1.id });
    expect(
      (del2 as { value: PlanOverview }).value.warnings.some((w) => w.includes('a été supprimée')),
    ).toBe(true);
    await engine.close();
  });

  it('refuse les cycles, la sous-division de l’introduction, la profondeur excessive et les éditions hors validation', async () => {
    const { engine, id } = await ready();
    const p = await plan(engine, id);
    const c1 = p.nodes.find((n) => n.templateKey === 'c1')!;
    const sec = p.nodes.find((n) => n.parentId === c1.id)!;
    const cyc = await call(engine, 'movePlanNode', {
      id,
      nodeId: c1.id,
      parentId: sec.id,
      index: 0,
    });
    expect(cyc.ok).toBe(false);
    const intro = p.nodes.find((n) => n.templateKey === 'intro')!;
    const sub = await call(engine, 'addPlanNode', {
      id,
      input: { parentId: intro.id, title: 'Nouvelle sous-partie' },
    });
    expect(sub.ok).toBe(false);
    // profondeur : section → sous-section → (refus)
    const s1 = await call<PlanOverview>(engine, 'addPlanNode', {
      id,
      input: { parentId: sec.id, title: 'Niveau 3' },
    });
    const ss = (s1 as { value: PlanOverview }).value.nodes.find((n) => n.title === 'Niveau 3')!;
    expect(ss.level).toBe('sous_section');
    const deep = await call(engine, 'addPlanNode', {
      id,
      input: { parentId: ss.id, title: 'Niveau 4' },
    });
    expect(deep.ok).toBe(false);
    // hors « en attente de validation »
    const r = await engine.handle('regeneratePlan', { id, comment: 'x' });
    expect(r.ok).toBe(true);
    await engine.planning.idle();
    await engine.close();
    const t = await briefed();
    const e = await call(t.engine, 'addPlanNode', {
      id: t.id,
      input: { parentId: null, title: 'x y' },
    });
    expect(e.ok).toBe(false);
    await t.engine.close();
  });

  it('nouvelle version avec commentaire : version 2, instructions et plan actuel transmis au modèle, cadrage et sources réutilisés', async () => {
    const { engine, mock, id } = await ready();
    const p = await plan(engine, id);
    const node = p.nodes.find((n) => n.templateKey === 'c1')!;
    await call(engine, 'updatePlanNode', {
      id,
      nodeId: node.id,
      patch: { title: 'Chapitre renommé par l’utilisateur' },
    });
    const before = mock.calls.filter((c) => c.meta?.label === 'plan:cadrage').length;
    const r = await call(engine, 'regeneratePlan', {
      id,
      comment: 'Insiste sur le microcrédit rural.',
    });
    expect(r.ok).toBe(true);
    expect(engine.missions.status(id)).toBe('planning');
    await engine.planning.idle();
    const p2 = await plan(engine, id);
    expect(p2.status).toBe('awaiting_plan_validation');
    expect(p2.version).toBe(2);
    expect(p2.instructions).toBe('Insiste sur le microcrédit rural.');
    const archi = mock.calls.filter((c) => c.meta?.label === 'plan:architecte').at(-1)!;
    const prompt = archi.messages[0]!.content;
    expect(prompt).toContain('Insiste sur le microcrédit rural.');
    expect(prompt).toContain('Chapitre renommé par l’utilisateur');
    // P1 et la recherche exploratoire ne sont pas refaites
    expect(mock.calls.filter((c) => c.meta?.label === 'plan:cadrage').length).toBe(before);
    expect(
      engine.db.prepare('SELECT COUNT(*) AS n FROM plan_versions WHERE mission_id=?').get(id),
    ).toEqual({ n: 2 });
    await engine.close();
  });
});

describe('validation du plan et lancement de la recherche (P3) puis de la rédaction', () => {
  it('fige le plan, met la recherche en file par section, exécute P3 et se termine proprement', async () => {
    const { engine, id } = await briefed();
    await generate(engine, id);
    const p = await plan(engine, id);
    const r = await engine.handle('validatePlan', { id });
    expect(r.ok).toBe(true);
    expect(engine.missions.status(id)).toBe('running');
    const planJson = JSON.parse(
      (
        engine.db.prepare('SELECT plan_json FROM missions WHERE id=?').get(id) as {
          plan_json: string;
        }
      ).plan_json,
    );
    expect(planJson.nodes).toHaveLength(p.nodes.length);
    // plus d'édition après validation
    expect((await engine.handle('deletePlanNode', { id, nodeId: p.nodes[0]!.id })).ok).toBe(false);

    const leaves = p.nodes.filter(
      (n) => n.kind === 'corps' && !p.nodes.some((c) => c.parentId === n.id),
    );
    const p3 = engine.db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE mission_id=? AND phase='P3'")
      .get(id) as { n: number };
    expect(p3.n).toBe(leaves.length);
    const done = await engine.runner.runUntilSettled(id, 3000);
    expect(done.status).toBe('completed');
    const events = engine.journal.list(id, 400).map((e) => e.messageFr);
    expect(events.some((m) => m.includes("Étapes disponibles terminées (jusqu'à P7)"))).toBe(true);
    // La matrice section ↔ sources est alimentée avec les identifiants du plan
    const rows = engine.db
      .prepare('SELECT DISTINCT section_key FROM section_sources WHERE mission_id=?')
      .all(id) as { section_key: string }[];
    expect(rows.length).toBeGreaterThan(0);
    const ids = new Set(p.nodes.map((n) => n.id));
    expect(rows.every((x) => ids.has(x.section_key))).toBe(true);
    // Seules des sources vérifiées sont retenues
    const bad = engine.db
      .prepare(
        `SELECT COUNT(*) AS n FROM section_sources ss JOIN sources s ON s.id=ss.source_id WHERE ss.mission_id=? AND s.verification_status NOT IN ('verified','partially_verified')`,
      )
      .get(id) as { n: number };
    expect(bad.n).toBe(0);
    await engine.close();
  });

  it('la problématique choisie est inscrite dans le brief à la validation', async () => {
    const { engine, id } = await briefed({
      brief: { problematique: undefined, problematiqueAProposer: true },
    });
    await generate(engine, id);
    const p = await plan(engine, id);
    const choice = p.cadrage!.problematiques[1]!.formulation;
    const s = await engine.handle('savePlanMeta', { id, patch: { problematiqueChoisie: choice } });
    expect(s.ok).toBe(true);
    expect((await engine.handle('validatePlan', { id })).ok).toBe(true);
    const brief = JSON.parse(
      (
        engine.db.prepare('SELECT brief_json FROM missions WHERE id=?').get(id) as {
          brief_json: string;
        }
      ).brief_json,
    );
    expect(brief.problematique).toBe(choice);
    expect(brief.problematiqueAProposer).toBe(false);
    await engine.close();
  });
});

describe('robustesse de la planification (§8.6)', () => {
  it('crédit épuisé pendant le plan : échec explicite en français, « Réessayer » relance la planification', async () => {
    const { engine, mock, id } = await briefed();
    mock.failNext(new AppError('E_NO_CREDIT'));
    await generate(engine, id);
    expect(engine.missions.status(id)).toBe('failed');
    const m = engine.missions.summary(id);
    expect(m.error?.code).toBe('E_NO_CREDIT');
    const retry = await engine.handle('retryMission', { id });
    expect(retry.ok).toBe(true);
    await engine.planning.idle();
    expect(engine.missions.status(id)).toBe('awaiting_plan_validation');
    await engine.close();
  });

  it('réponse du modèle inexploitable : échec propre (jamais de plan à moitié écrit)', async () => {
    const { engine, mock, id } = await briefed();
    let n = 0;
    const orig = mock.complete.bind(mock);
    mock.complete = async (req) => {
      if (req.meta?.label === 'plan:architecte' && n++ < 2) {
        const r = await orig(req);
        return { ...r, content: 'ceci n’est pas du JSON' };
      }
      return orig(req);
    };
    await generate(engine, id);
    expect(engine.missions.status(id)).toBe('failed');
    expect(engine.outline.list(id)).toHaveLength(0);
    expect(engine.missions.summary(id).error?.code).toBe('E_SCHEMA');
    await engine.close();
  });

  it('annulation pendant la planification : aucun plan écrit, statut « annulée »', async () => {
    const { engine, id } = await briefed();
    await engine.handle('generatePlan', { id });
    await engine.handle('cancelMission', { id });
    await engine.planning.idle();
    expect(engine.missions.status(id)).toBe('cancelled');
    expect(engine.outline.list(id)).toHaveLength(0);
    await engine.close();
  });

  it('redémarrage pendant la planification : elle reprend et aboutit', async () => {
    const t = await briefed();
    // État « planification en cours » laissé par un arrêt brutal.
    t.engine.missions.transition(t.id, 'planning', {
      reason: 'Cadrage et plan en cours de préparation.',
    });
    expect(t.engine.planning.recover()).toEqual([t.id]);
    await t.engine.planning.idle();
    expect(t.engine.missions.status(t.id)).toBe('awaiting_plan_validation');
    await t.engine.close();
  });

  it('réseau coupé : la recherche exploratoire échoue sans bloquer, le plan est proposé avec un avertissement', async () => {
    const { engine, id } = await briefed();
    // Aucun connecteur simulé ne répond : liste vide.
    engine.mockSources.forEach((c) => {
      c.search = async () => {
        throw new AppError('E_NETWORK');
      };
    });
    await generate(engine, id);
    const p = await plan(engine, id);
    expect(p.status).toBe('awaiting_plan_validation');
    expect(p.exploratory).toHaveLength(0);
    expect(p.warnings.some((w) => w.includes('Aucune source candidate'))).toBe(true);
    await engine.close();
  });
});
