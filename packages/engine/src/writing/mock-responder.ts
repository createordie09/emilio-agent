import type { LlmRequest } from '../llm/types';

const sys = (req: LlmRequest): string =>
  req.messages.find((m) => m.role === 'system')?.content ?? '';
const FILLERS = ['notamment', 'ici', 'surtout', 'précisément'];
const ORDINAL = [
  'premier',
  'deuxième',
  'troisième',
  'quatrième',
  'cinquième',
  'sixième',
  'septième',
  'huitième',
  'neuvième',
  'dixième',
  'onzième',
  'douzième',
];
const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);
const sentences = (s: string): string[] =>
  s
    .replace(/\bpp?\.\s/g, (m) => m.replace(' ', '§§'))
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.replace(/§§/g, ' ').trim())
    .filter(Boolean);

/** Paraphrase de démonstration : un mot d'insertion tous les cinq mots coupe toute séquence de 8 mots identiques (§12.4) tout en gardant le fond. */
const paraphrase = (s: string): string => {
  const w = words(s.replace(/[.]+$/, ''));
  const out: string[] = [];
  w.forEach((x, i) => {
    out.push(x);
    if ((i + 1) % 5 === 0 && i < w.length - 1) out.push(FILLERS[((i / 5) % FILLERS.length) | 0]!);
  });
  return out.join(' ');
};

const wordsOf = (md: string) =>
  words(
    md
      .replace(/\{\{TABLEAU:[^}]*\}\}/g, '')
      .replace(/\[@[^\]]*\]/g, '')
      .replace(/^#+\s*/gm, ''),
  ).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * Répondeur déterministe du client simulé pour l'analyse de données (P4) et la rédaction (P5) — mode simulé, CdC §21.2.
 * Il lit le prompt rendu et produit des JSON conformes aux schémas ; `undefined` si l'appel n'est pas de ce domaine.
 */
export function writingMockRespond(req: LlmRequest): string | undefined {
  const label = req.meta?.label ?? '';
  const prompt = sys(req);
  switch (label) {
    case 'analyse:plan': {
      const cols = [
        ...prompt.matchAll(/^- (.+?) \((categorical|boolean|integer|number|date|text)/gm),
      ].map((m) => ({ name: m[1]!, type: m[2]! }));
      const cat = cols.filter((c) => c.type === 'categorical' || c.type === 'boolean');
      const num = cols.filter((c) => c.type === 'integer' || c.type === 'number');
      const analyses: object[] = [];
      if (cat[0])
        analyses.push({
          type: 'frequencies',
          variables: [cat[0].name],
          hypothese: 'H1',
          justification: '[simulé] Profil de l’échantillon.',
        });
      if (cat[0] && cat[1])
        analyses.push({
          type: 'crosstab',
          variables: [cat[0].name, cat[1].name],
          hypothese: 'H1',
          justification: '[simulé] Association entre deux variables.',
        });
      if (num[0] && num[1])
        analyses.push({
          type: 'correlation',
          variables: [num[0].name, num[1].name],
          hypothese: 'H2',
          justification: '[simulé] Lien entre deux mesures.',
        });
      if (num[0] && cat[0])
        analyses.push({
          type: 'group_means',
          variables: [num[0].name, cat[0].name],
          justification: '[simulé] Comparaison des groupes.',
        });
      analyses.push({
        type: 'frequencies',
        variables: ['Variable inexistante'],
        justification: '[simulé] Doit être écartée par le code.',
      });
      return JSON.stringify({ analyses, manques: [] });
    }
    case 'analyse:interpretation': {
      const faits = [...prompt.matchAll(/^(A\d+) \((Tableau \d+)\) : (.+)$/gm)].map((m) => ({
        id: m[1]!,
        fact: m[3]!,
      }));
      const hyps = [...prompt.matchAll(/^H(\d+) : (.+)$/gm)].map((m) => m[2]!);
      const strip = (t: string) => t.replace(/[«»]/g, '').split(/(?<=\.)\s/)[0]!;
      const test = faits.find((f) => /khi-deux|Pearson/.test(f.fact));
      return JSON.stringify({
        interpretation: [
          `[simulé] Profil de l’échantillon : ${faits[0] ? strip(faits[0].fact) : 'aucun résultat'} [${faits[0]?.id ?? 'A1'}]`,
          test ? `Test statistique : ${strip(test.fact)} [${test.id}]` : '',
          '[simulé] Dans la région, le taux d’adoption atteindrait 87 % des ménages.',
        ]
          .filter(Boolean)
          .join('\n\n'),
        hypotheses: hyps.map((h, i) => ({
          hypothese: `H${i + 1} ${h}`,
          statut: 'confirmee',
          analyses: test ? [test.id] : [],
          justification: '[simulé] Voir le test.',
        })),
        limites: ['[simulé] Échantillon de taille limitée.'],
        manques: [],
      });
    }
    case 'redaction:section': {
      const target = Number(/Longueur visée : (\d+) mots/.exec(prompt)?.[1] ?? 400);
      const title = (/section « ([^»]+) » d'un/.exec(prompt)?.[1] ?? 'la section').replace(
        /^[\d.]+\s*/,
        '',
      );
      const ex = [
        ...prompt.matchAll(/^\[(E\d+)\] \(source (A\d+)(?:, p\. ([^)]*))?\) (.+)$/gm),
      ].map((m) => ({ alias: m[1]!, src: m[2]!, page: m[3] ?? null, text: m[4]! }));
      const labels = new Map([...prompt.matchAll(/^(A\d+) : (.+)$/gm)].map((m) => [m[1]!, m[2]!]));
      const fact = /^A1 \(Tableau 1[^)]*\) : (.+)$/m.exec(prompt)?.[1]?.replace(/[«»]/g, '');
      const tableId = /\{\{TABLEAU:(A\d+)\}\}/.exec(prompt)?.[1];
      const claims: { phrase: string; source_id: string; chunk_id: string; page?: string }[] = [];
      const pool: string[] = [];
      for (const e of ex) {
        const ss = sentences(e.text);
        const marker = `[@${e.src}${e.page ? `, p. ${e.page}` : ''}]`;
        const s0 = paraphrase(ss[0] ?? e.text);
        const sentence = `Selon ${labels.get(e.src) ?? 'la source'}, ${s0.charAt(0).toLowerCase()}${s0.slice(1)} ${marker}.`;
        pool.push(sentence);
        claims.push({
          phrase: sentence.replace(/\s*\[@[^\]]*\]/g, ''),
          source_id: e.src,
          chunk_id: e.alias,
          ...(e.page ? { page: e.page } : {}),
        });
        const q = words(ss[0] ?? e.text)
          .slice(0, 8)
          .join(' ');
        const quoteSentence = `Les auteurs rappellent que « ${q} » ${marker}.`;
        pool.push(quoteSentence);
        claims.push({
          phrase: quoteSentence.replace(/\s*\[@[^\]]*\]/g, ''),
          source_id: e.src,
          chunk_id: e.alias,
        });
      }
      if (fact) pool.push(`Les résultats de terrain indiquent que ${fact}`);
      const out: string[] = [];
      let count = 0;
      let k = 0;
      let para: string[] = [];
      const flush = () => {
        if (para.length) out.push(para.join(' '));
        para = [];
      };
      const target1 = Math.round(target * 0.98);
      while (count < target1 && k < 400) {
        const s = pool.length ? pool[k % pool.length]! : '';
        const neutral = `Un ${ORDINAL[k % ORDINAL.length]} point concerne ${title.toLowerCase()} et son articulation avec la problématique du travail.`;
        const use = k % 3 === 2 || !s ? neutral : s;
        // les phrases sourcées ne sont répétées qu'une fois pour ne pas gonfler le nombre d'affirmations
        const text = use === s && k >= pool.length * 3 ? neutral : use;
        para.push(text);
        count += words(text.replace(/\[@[^\]]*\]/g, '')).length;
        k++;
        if (para.length === 4) {
          flush();
          if (k % 8 === 0) out.push(`#### Sous-partie ${k / 8}`);
          if (tableId && k === 8) out.push(`{{TABLEAU:${tableId}}}`);
        }
      }
      flush();
      if (!ex.length)
        out.unshift(
          '[INFORMATION MANQUANTE : aucune source vérifiée n’a été fournie pour cette section]',
        );
      const md = out.join('\n\n');
      return JSON.stringify({
        markdown: md,
        claims,
        mots: wordsOf(md),
        manques: ex.length ? [] : ['Sources à compléter'],
      });
    }
    case 'redaction:general': {
      const target = Number(/Longueur visée : (\d+) mots/.exec(prompt)?.[1] ?? 400);
      const problematique = /Problématique : (.+)/.exec(prompt)?.[1] ?? '';
      const heads = (/Plan de cette partie[^\n]*\n((?:- .+\n?)+)/.exec(prompt)?.[1] ?? '')
        .split('\n')
        .map((l) => l.replace(/^- /, '').trim())
        .filter((l) => l && !l.startsWith('('));
      const out: string[] = [];
      let k = 0;
      const per = Math.max(1, heads.length);
      const budget = Math.round((target * 0.98) / per);
      for (const h of heads.length ? heads : ['']) {
        if (h) out.push(`#### ${h}`);
        let c = 0;
        const paras: string[] = [];
        while (c < budget && k < 600) {
          const s =
            k % 4 === 0 && problematique
              ? `Le travail s’articule autour de la question suivante : ${problematique}`
              : `Un ${ORDINAL[k % ORDINAL.length]} élément de synthèse précise la contribution de cette partie au raisonnement d’ensemble.`;
          paras.push(s);
          c += words(s).length;
          k++;
          if (paras.length === 4) {
            out.push(paras.join(' '));
            paras.length = 0;
          }
        }
        if (paras.length) out.push(paras.join(' '));
      }
      const md = out.join('\n\n');
      return JSON.stringify({ markdown: md, claims: [], mots: wordsOf(md), manques: [] });
    }
    case 'redaction:correction': {
      const md = /Texte actuel :\n([\s\S]*?)\n\nProblèmes à corriger/.exec(prompt)?.[1] ?? '';
      const bad = [...prompt.matchAll(/- Phrase : « ([\s\S]*?) »\n\s+Problème :/g)].map((m) =>
        m[1]!.trim(),
      );
      let out = md;
      for (const b of bad) {
        const stripped = b.replace(/\s+/g, ' ');
        const parts = sentences(out);
        const hit = parts.find((p) =>
          p
            .replace(/\[@[^\]]*\]/g, '')
            .replace(/\s+/g, ' ')
            .replace(/\s+([.,;:!?])/g, '$1')
            .includes(stripped.replace(/\s+([.,;:!?])/g, '$1')),
        );
        if (hit) out = out.replace(hit, '').replace(/ {2,}/g, ' ');
      }
      return JSON.stringify({
        markdown: out.replace(/\n{3,}/g, '\n\n').trim() || md,
        claims: [],
        mots: wordsOf(out),
        manques: [],
      });
    }
    case 'redaction:ancrage': {
      const items = [...prompt.matchAll(/^C(\d+) : (.+)\n((?: {3}Extrait .+\n?)+)/gm)];
      const verdicts = items.map((m) => {
        const claim = new Set(
          (m[2]!.toLowerCase().match(/[\p{L}]{4,}/gu) ?? []).filter((w) => !FILLERS.includes(w)),
        );
        const ext = m[3]!.toLowerCase();
        let hit = 0;
        for (const w of claim) if (ext.includes(w)) hit++;
        const ok = claim.size > 0 && hit / claim.size >= 0.5;
        return {
          id: `C${m[1]}`,
          niveau: ok ? 'supported' : 'unsupported',
          justification: ok ? '[simulé] Soutenue par l’extrait.' : '[simulé] Absente de l’extrait.',
        };
      });
      return JSON.stringify({ verdicts });
    }
    case 'redaction:resume': {
      const text = /Texte de la section :\n([\s\S]*?)\n\nRègles :/.exec(prompt)?.[1] ?? '';
      const ss = sentences(text.replace(/^#+\s.*$/gm, ''));
      const out: string[] = [];
      let c = 0;
      let k = 0;
      while (c < 170 && ss.length && k < 200) {
        const s = ss[k % ss.length]!;
        out.push(s);
        c += words(s).length;
        k++;
      }
      return JSON.stringify({
        resume: out.join(' ') || '[simulé] Résumé.',
        mots_cles: [],
        manques: [],
      });
    }
    case 'redaction:resume_global': {
      const titre = /intitulé « ([^»]+) »/.exec(prompt)?.[1] ?? 'le travail';
      const resumes = (
        /Résumés des sections :\n([\s\S]*?)\n(?:Statut|\nRègles|Règles)/.exec(prompt)?.[1] ?? ''
      )
        .split('\n')
        .map((l) => l.replace(/^\[[^\]]*\][^:]*: /, ''));
      const ss = sentences(resumes.join(' '));
      const out: string[] = [`Ce travail porte sur ${titre.toLowerCase()}.`];
      let c = words(out[0]!).length;
      for (let k = 0; c < 215 && ss.length && k < 100; k++) {
        out.push(ss[k % ss.length]!);
        c += words(ss[k % ss.length]!).length;
      }
      return JSON.stringify({
        resume: out.join(' '),
        mots_cles: titre
          .split(/\s+/)
          .filter((w) => w.length > 6)
          .slice(0, 4),
        manques: [],
      });
    }
    case 'redaction:abstract': {
      const fr = /French abstract:\n([\s\S]*?)\n\nKeywords:/.exec(prompt)?.[1] ?? '';
      const kw = /Keywords: (.+)/.exec(prompt)?.[1] ?? '';
      return JSON.stringify({
        resume: `[Simulated English translation] ${fr}`,
        mots_cles: kw
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
        manques: [],
      });
    }
    default:
      return undefined;
  }
}
