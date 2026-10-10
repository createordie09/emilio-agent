import {
  AppError,
  OUTLINE_LEVELS,
  type OutlineKind,
  type OutlineLevel,
  type OutlineNodeView,
  type PlanNodeInput,
  type PlanNodePatch,
} from '@emilio/shared';
import { newId, nowIso, type Db } from '../storage/db';
import type { StructureNode, StructureTemplate } from './config';
import type { PlanOutput } from './schemas';

type Row = {
  id: string;
  parent_id: string | null;
  ordinal: number;
  level: OutlineLevel;
  kind: OutlineKind;
  numbering: string | null;
  title: string;
  objective: string | null;
  key_questions_json: string | null;
  target_words: number | null;
  required_sources_min: number | null;
  sources_json: string | null;
  remarks: string | null;
  template_key: string | null;
};

const levelIdx = (l: OutlineLevel): number => OUTLINE_LEVELS.indexOf(l);

function toView(r: Row): OutlineNodeView {
  return {
    id: r.id,
    parentId: r.parent_id,
    ordinal: r.ordinal,
    level: r.level,
    kind: r.kind,
    numbering: r.numbering,
    title: r.title,
    objective: r.objective ?? '',
    keyQuestions: JSON.parse(r.key_questions_json ?? '[]') as string[],
    targetWords: r.target_words ?? 0,
    requiredSourcesMin: r.required_sources_min ?? 0,
    sourceIds: JSON.parse(r.sources_json ?? '[]') as string[],
    remarks: r.remarks,
    templateKey: r.template_key,
  };
}

/** Nœud en mémoire (avant écriture), arbre complet. */
export type DraftNode = {
  key: string | null;
  level: OutlineLevel;
  kind: OutlineKind;
  title: string;
  objective: string;
  keyQuestions: string[];
  weight: number | null;
  sourceIds: string[];
  remarks: string | null;
  children: DraftNode[];
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Numérotation (§5.8) : parties en chiffres romains, chapitres en continu, sections « 2.3 », sous-sections « 2.3.1 ». Introduction/conclusion générales : non numérotées. */
export function computeNumbering(nodes: OutlineNodeView[]): Map<string, string | null> {
  const kids = new Map<string | null, OutlineNodeView[]>();
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  for (const list of kids.values()) list.sort((a, b) => a.ordinal - b.ordinal);
  const out = new Map<string, string | null>();
  let chapter = 0;
  let part = 0;
  const walk = (parent: string | null, prefix: string | null) => {
    let idx = 0;
    for (const n of kids.get(parent) ?? []) {
      if (n.kind !== 'corps') {
        out.set(n.id, null);
        walk(n.id, null);
        continue;
      }
      if (n.level === 'partie') {
        out.set(n.id, ROMAN[part++] ?? String(part));
        walk(n.id, String(part));
        continue;
      }
      if (n.level === 'chapitre') {
        const num = String(++chapter);
        out.set(n.id, num);
        walk(n.id, num);
        continue;
      }
      idx++;
      const num = prefix ? `${prefix}.${idx}` : String(idx);
      out.set(n.id, num);
      walk(n.id, num);
    }
  };
  walk(null, null);
  return out;
}

/** Les enfants d'une partie sans chapitre (rapport de stage) se numérotent « 1.1 » ; ceux d'un chapitre, « 3.1 ». */
export function leaves(nodes: OutlineNodeView[]): OutlineNodeView[] {
  const parents = new Set(nodes.map((n) => n.parentId));
  return nodes.filter((n) => !parents.has(n.id));
}

/** Répartition des mots : poids relatifs (gabarit, sinon proposition du modèle), normalisés pour atteindre exactement `total`. */
export function allocateWords(roots: DraftNode[], total: number): Map<DraftNode, number> {
  const out = new Map<DraftNode, number>();
  const weightOf = (n: DraftNode): number => {
    if (n.weight && n.weight > 0) return n.weight;
    if (n.children.length) return n.children.reduce((s, c) => s + weightOf(c), 0);
    return 0;
  };
  const split = (list: DraftNode[], budget: number) => {
    const known = list.map(weightOf);
    const positives = known.filter((w) => w > 0);
    const fallback = positives.length ? positives.reduce((a, b) => a + b, 0) / positives.length : 1;
    const ws = known.map((w) => (w > 0 ? w : fallback));
    const sum = ws.reduce((a, b) => a + b, 0) || 1;
    let given = 0;
    list.forEach((n, i) => {
      const part =
        i === list.length - 1 ? budget - given : Math.round((budget * ws[i]!) / sum / 10) * 10;
      given += part;
      out.set(n, Math.max(0, part));
      if (n.children.length) split(n.children, Math.max(0, part));
    });
  };
  split(roots, total);
  return out;
}

/**
 * Fusionne la proposition du modèle avec le gabarit imposé (§15.3) :
 * tout nœud du gabarit est conservé (restauré s'il manque), les ajouts du modèle ne sont acceptés
 * qu'à partir du niveau « section » (ou partout si le gabarit l'autorise).
 */
export function mergeProposal(
  out: PlanOutput,
  template: StructureTemplate | undefined,
  enforce: boolean,
): { roots: DraftNode[]; notes: string[] } {
  const notes: string[] = [];
  const byRef = new Map<string, DraftNode>();
  const parentOf = new Map<string, string | null>();
  const roots: DraftNode[] = [];
  const tplByKey = new Map<string, StructureNode>();
  const indexTpl = (n: StructureNode) => {
    tplByKey.set(n.key, n);
    n.children?.forEach(indexTpl);
  };
  template?.nodes.forEach(indexTpl);

  for (const raw of out.noeuds) {
    const tpl = raw.cle ? tplByKey.get(raw.cle) : undefined;
    const node: DraftNode = {
      key: tpl ? tpl.key : null,
      level: tpl?.level ?? raw.niveau ?? 'section',
      kind: tpl?.kind ?? 'corps',
      title: tpl ? raw.titre?.trim() || tpl.title : raw.titre.trim(),
      objective: raw.objectif.trim(),
      keyQuestions: raw.questions_cles.map((q) => q.trim()).filter(Boolean),
      weight: tpl?.share ?? (raw.mots_cibles > 0 ? raw.mots_cibles : null),
      sourceIds: raw.sources,
      remarks: raw.remarques?.trim() || null,
      children: [],
    };
    byRef.set(raw.ref, node);
    parentOf.set(raw.ref, raw.parent ?? null);
  }
  for (const raw of out.noeuds) {
    const node = byRef.get(raw.ref)!;
    const p = raw.parent ? byRef.get(raw.parent) : undefined;
    if (p && p !== node) p.children.push(node);
    else roots.push(node);
  }

  if (enforce && template) {
    // Les nœuds ajoutés au niveau partie / chapitre sont écartés (sauf gabarit ouvert) : leurs enfants remontent d'un cran.
    if (!template.allowExtraChapters) {
      const strip = (list: DraftNode[]): DraftNode[] =>
        list.flatMap((n) => {
          n.children = strip(n.children);
          if (!n.key && (n.level === 'partie' || n.level === 'chapitre')) {
            notes.push(`Chapitre non prévu par la structure imposée écarté : « ${n.title} ».`);
            return n.children;
          }
          return [n];
        });
      roots.splice(0, roots.length, ...strip(roots));
    }
    // Restauration des nœuds du gabarit absents, à leur place (même parent de gabarit).
    const present = new Set<string>();
    const mark = (n: DraftNode) => {
      if (n.key) present.add(n.key);
      n.children.forEach(mark);
    };
    roots.forEach(mark);
    const fromTpl = (t: StructureNode): DraftNode => ({
      key: t.key,
      level: t.level,
      kind: t.kind,
      title: t.title,
      objective: '',
      keyQuestions: [],
      weight: t.share ?? null,
      sourceIds: [],
      remarks: 'Section du gabarit restaurée : à préciser.',
      children: (t.children ?? []).map(fromTpl),
    });
    const restore = (tplNodes: StructureNode[], into: DraftNode[]) => {
      tplNodes.forEach((t, i) => {
        let node = into.find((n) => n.key === t.key);
        if (!node) {
          node = fromTpl(t);
          into.splice(Math.min(i, into.length), 0, node);
          notes.push(`Section « ${t.title} » du gabarit manquante : restaurée.`);
          return;
        }
        if (t.children?.length) restore(t.children, node.children);
      });
    };
    restore(template.nodes, roots);
    // Ordre du gabarit pour les nœuds du gabarit au niveau racine.
    const order = new Map(template.nodes.map((t, i) => [t.key, i]));
    roots.sort((a, b) => (order.get(a.key ?? '') ?? 1e6) - (order.get(b.key ?? '') ?? 1e6));
  }
  return { roots, notes };
}

export class OutlineRepo {
  constructor(private readonly db: Db) {}

  list(missionId: string): OutlineNodeView[] {
    const rows = this.db
      .prepare('SELECT * FROM outline_nodes WHERE mission_id=? ORDER BY ordinal')
      .all(missionId) as Row[];
    const views = rows.map(toView);
    return orderDepthFirst(views);
  }

  /** Remplace tout le plan d'une mission (génération d'une nouvelle version). */
  replace(
    missionId: string,
    roots: DraftNode[],
    words: Map<DraftNode, number>,
    minSources: number,
  ): void {
    const t = nowIso();
    const ins = this.db.prepare(
      `INSERT INTO outline_nodes(id,mission_id,parent_id,ordinal,level,kind,numbering,title,objective,key_questions_json,target_words,required_sources_min,sources_json,remarks,template_key,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM outline_nodes WHERE mission_id=?').run(missionId);
      let ord = 0;
      const walk = (list: DraftNode[], parent: string | null) => {
        for (const n of list) {
          const id = newId();
          const isLeaf = n.children.length === 0;
          ins.run(
            id,
            missionId,
            parent,
            ord++,
            n.level,
            n.kind,
            null,
            n.title,
            n.objective,
            JSON.stringify(n.keyQuestions),
            words.get(n) ?? 0,
            isLeaf && n.kind === 'corps' ? minSources : 0,
            JSON.stringify(n.sourceIds),
            n.remarks,
            n.key,
            t,
            t,
          );
          walk(n.children, id);
        }
      };
      walk(roots, null);
      this.renumber(missionId);
    })();
  }

  renumber(missionId: string): void {
    const nodes = this.list(missionId);
    const nums = computeNumbering(nodes);
    const upd = this.db.prepare(
      'UPDATE outline_nodes SET numbering=?, ordinal=?, updated_at=? WHERE id=?',
    );
    const t = nowIso();
    nodes.forEach((n, i) => upd.run(nums.get(n.id) ?? null, i, t, n.id));
  }

  private get(missionId: string, nodeId: string): OutlineNodeView {
    const n = this.list(missionId).find((x) => x.id === nodeId);
    if (!n) throw new AppError('E_BAD_REQUEST', 'Section introuvable dans le plan.');
    return n;
  }

  update(missionId: string, nodeId: string, patch: PlanNodePatch): void {
    this.get(missionId, nodeId);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.title !== undefined) {
      if (patch.title.trim().length < 2)
        throw new AppError('E_BAD_REQUEST', 'Le titre de la section ne peut pas être vide.');
      sets.push('title=?');
      vals.push(patch.title.trim());
    }
    if (patch.objective !== undefined) {
      sets.push('objective=?');
      vals.push(patch.objective.trim());
    }
    if (patch.keyQuestions !== undefined) {
      sets.push('key_questions_json=?');
      vals.push(JSON.stringify(patch.keyQuestions.map((q) => q.trim()).filter(Boolean)));
    }
    if (patch.targetWords !== undefined) {
      if (!Number.isFinite(patch.targetWords) || patch.targetWords < 0)
        throw new AppError('E_BAD_REQUEST', 'Le nombre de mots doit être positif.');
      sets.push('target_words=?');
      vals.push(Math.round(patch.targetWords));
    }
    if (patch.requiredSourcesMin !== undefined) {
      sets.push('required_sources_min=?');
      vals.push(Math.max(0, Math.round(patch.requiredSourcesMin)));
    }
    if (!sets.length) return;
    this.db
      .prepare(`UPDATE outline_nodes SET ${sets.join(',')}, updated_at=? WHERE id=?`)
      .run(...vals, nowIso(), nodeId);
    this.renumber(missionId);
  }

  add(missionId: string, input: PlanNodeInput, defaultSources: number): void {
    const nodes = this.list(missionId);
    const parent = input.parentId ? nodes.find((n) => n.id === input.parentId) : null;
    if (input.parentId && !parent)
      throw new AppError('E_BAD_REQUEST', 'Section parente introuvable.');
    if (parent && parent.kind !== 'corps')
      throw new AppError(
        'E_BAD_REQUEST',
        "L'introduction et la conclusion générales ne se subdivisent pas librement.",
      );
    const level = parent
      ? OUTLINE_LEVELS[Math.max(levelIdx(input.level ?? 'section'), levelIdx(parent.level) + 1)]
      : (input.level ?? 'chapitre');
    if (!level) throw new AppError('E_BAD_REQUEST', 'Profondeur maximale du plan atteinte.');
    if (parent && parent.level === 'sous_section')
      throw new AppError('E_BAD_REQUEST', 'Profondeur maximale du plan atteinte.');
    const title = input.title.trim();
    if (title.length < 2) throw new AppError('E_BAD_REQUEST', 'Indiquez un titre.');
    const siblings = nodes.filter((n) => n.parentId === (input.parentId ?? null));
    const idx = Math.max(0, Math.min(input.index ?? siblings.length, siblings.length));
    const id = newId();
    const t = nowIso();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO outline_nodes(id,mission_id,parent_id,ordinal,level,kind,title,objective,key_questions_json,target_words,required_sources_min,sources_json,created_at,updated_at)
           VALUES (?,?,?,?,?,'corps',?,'','[]',0,?,'[]',?,?)`,
        )
        .run(id, missionId, input.parentId ?? null, 1e6, level, title, defaultSources, t, t);
      this.reorder(missionId, id, input.parentId ?? null, idx);
    })();
  }

  remove(missionId: string, nodeId: string): void {
    this.get(missionId, nodeId);
    this.db.prepare('DELETE FROM outline_nodes WHERE id=?').run(nodeId);
    this.renumber(missionId);
  }

  move(missionId: string, nodeId: string, parentId: string | null, index: number): void {
    const nodes = this.list(missionId);
    const node = this.get(missionId, nodeId);
    const parent = parentId ? nodes.find((n) => n.id === parentId) : null;
    if (parentId && !parent) throw new AppError('E_BAD_REQUEST', 'Section parente introuvable.');
    if (parent) {
      // Pas de cycle : le parent ne peut pas être le nœud lui-même ni l'un de ses descendants.
      let cur: OutlineNodeView | undefined = parent;
      while (cur) {
        if (cur.id === nodeId)
          throw new AppError(
            'E_BAD_REQUEST',
            'Une section ne peut pas être placée dans elle-même.',
          );
        cur = nodes.find((n) => n.id === cur!.parentId);
      }
      if (parent.kind !== 'corps')
        throw new AppError(
          'E_BAD_REQUEST',
          "L'introduction et la conclusion générales ne se subdivisent pas librement.",
        );
    }
    // Niveaux recalculés pour tout le sous-arbre ; refus si la profondeur dépasse « sous-section ».
    const newLevels = new Map<string, OutlineLevel>();
    const relevel = (n: OutlineNodeView, parentLevel: OutlineLevel | null): void => {
      const min = parentLevel ? levelIdx(parentLevel) + 1 : 0;
      let lv = Math.max(levelIdx(n.level), min);
      if (!parentLevel && lv > levelIdx('section')) lv = levelIdx('section');
      const level = OUTLINE_LEVELS[lv];
      if (!level) throw new AppError('E_BAD_REQUEST', 'Profondeur maximale du plan atteinte.');
      newLevels.set(n.id, level);
      for (const c of nodes.filter((x) => x.parentId === n.id)) relevel(c, level);
    };
    relevel(node, parent?.level ?? null);
    const t = nowIso();
    this.db.transaction(() => {
      for (const [id, level] of newLevels)
        this.db
          .prepare('UPDATE outline_nodes SET level=?, updated_at=? WHERE id=?')
          .run(level, t, id);
      this.reorder(missionId, nodeId, parentId, index);
    })();
  }

  /** Place le nœud à `index` parmi les enfants de `parentId`, puis renumérote. */
  private reorder(missionId: string, nodeId: string, parentId: string | null, index: number): void {
    const all = this.list(missionId);
    const siblings = all.filter((n) => n.parentId === parentId && n.id !== nodeId);
    const at = Math.max(0, Math.min(index, siblings.length));
    this.db.prepare('UPDATE outline_nodes SET parent_id=? WHERE id=?').run(parentId, nodeId);
    const order = [
      ...siblings.slice(0, at).map((n) => n.id),
      nodeId,
      ...siblings.slice(at).map((n) => n.id),
    ];
    // Ordinal global = rang dans le parcours en profondeur : on reconstruit l'ordre complet.
    const children = new Map<string | null, string[]>();
    for (const n of all) {
      if (n.id === nodeId) continue;
      children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
    }
    children.set(parentId, order);
    for (const [k, v] of children) {
      if (k === parentId) continue;
      children.set(
        k,
        v.sort(
          (a, b) =>
            (all.find((x) => x.id === a)?.ordinal ?? 0) -
            (all.find((x) => x.id === b)?.ordinal ?? 0),
        ),
      );
    }
    const upd = this.db.prepare('UPDATE outline_nodes SET ordinal=? WHERE id=?');
    let i = 0;
    const walk = (p: string | null) => {
      for (const id of children.get(p) ?? []) {
        upd.run(i++, id);
        walk(id);
      }
    };
    walk(null);
    this.renumber(missionId);
  }

  setStatus(nodeId: string, status: 'planned' | 'researching'): void {
    this.db
      .prepare('UPDATE outline_nodes SET status=?, updated_at=? WHERE id=?')
      .run(status, nowIso(), nodeId);
  }
}

/** Ordre de lecture (parcours en profondeur) à partir des ordinaux. */
function orderDepthFirst(nodes: OutlineNodeView[]): OutlineNodeView[] {
  const kids = new Map<string | null, OutlineNodeView[]>();
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  const out: OutlineNodeView[] = [];
  const walk = (p: string | null) => {
    for (const n of (kids.get(p) ?? []).sort((a, b) => a.ordinal - b.ordinal)) {
      out.push(n);
      walk(n.id);
    }
  };
  walk(null);
  return out;
}
