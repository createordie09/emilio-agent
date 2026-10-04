import type { FinalCheckView, JuryScopeView } from '@emilio/shared';
import { VERDICT_LABEL_FR } from '@emilio/shared';

export type ReportData = {
  title: string;
  generatedAt: string;
  params: { label: string; value: string }[];
  durationMin: number | null;
  costTotalUsd: number;
  costByPhase: {
    phase: string;
    label: string;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
  }[];
  sources: {
    found: number;
    verified: number;
    partially: number;
    unverified: number;
    rejected: number;
    cited: number;
    rejectedList: { title: string; reason: string }[];
  };
  jury: JuryScopeView[];
  attention: string[];
  finalCheck: FinalCheckView | null;
  search: { connectors: Record<string, number>; queries: { section: string; texte: string }[] };
  deliverables: { label: string; filename: string }[];
  skipped: { label: string; reason: string }[];
  aiDeclaration: string;
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const usd = (n: number): string => `${n.toFixed(2).replace('.', ',')} $`;
const note = (n: number | null): string => (n === null ? '—' : n.toFixed(1).replace('.', ','));

/** Rapport de mission (CdC §16.4) : page HTML autonome, imprimable. */
export function buildReportHtml(d: ReportData): string {
  const t = (rows: string[][], head: string[]) =>
    `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`;
  const juryRows = d.jury.flatMap((s) =>
    s.rounds.map((r) => [s.title, `Ronde ${r.round}`, note(r.total), VERDICT_LABEL_FR[r.verdict]]),
  );
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport de mission — ${esc(d.title)}</title>
<style>
body{font-family:Calibri,Arial,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#1f2937;line-height:1.5}
h1{font-size:1.6rem} h2{font-size:1.2rem;margin-top:2rem;border-bottom:1px solid #ddd;padding-bottom:.2rem}
table{border-collapse:collapse;width:100%;font-size:.9rem;margin:.5rem 0} th,td{border:1px solid #ccc;padding:.3rem .5rem;text-align:left} th{background:#ede9fe}
.ok{color:#0a7d4b}.warn{color:#b45309}.ko{color:#b91c1c} mark{background:#ff0} small{color:#6b7280}
@media print{body{max-width:none}}
</style></head><body>
<h1>Rapport de mission</h1>
<p><strong>${esc(d.title)}</strong><br><small>Généré le ${esc(d.generatedAt)}</small></p>

<h2>Paramètres utilisés</h2>
${t(
  d.params.map((p) => [p.label, p.value]),
  ['Paramètre', 'Valeur'],
)}
<p>${d.durationMin !== null ? `Durée : ${d.durationMin} minute(s). ` : ''}Coût total : ${usd(d.costTotalUsd)}.</p>

<h2>Coût par phase</h2>
${t(
  d.costByPhase.map((c) => [
    `${c.phase} — ${c.label}`,
    usd(c.costUsd),
    String(c.tokensIn),
    String(c.tokensOut),
  ]),
  ['Phase', 'Coût', 'Jetons envoyés', 'Jetons reçus'],
)}

<h2>Sources documentaires</h2>
<p>${d.sources.found} trouvée(s) · ${d.sources.verified} vérifiée(s) · ${d.sources.partially} partiellement vérifiée(s) · ${d.sources.rejected} rejetée(s) · ${d.sources.cited} citée(s) dans le texte.</p>
${
  d.sources.rejectedList.length
    ? t(
        d.sources.rejectedList.map((r) => [r.title, r.reason]),
        ['Source rejetée', 'Raison'],
      )
    : '<p>Aucune source rejetée.</p>'
}

<h2>Notes du jury</h2>
${juryRows.length ? t(juryRows, ['Chapitre ou ensemble', 'Évaluation', 'Note sur 20', 'Verdict']) : '<p>Le jury n’a pas évalué ce travail.</p>'}

<h2>Points d’attention</h2>
${d.attention.length ? `<ul>${d.attention.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '<p>Aucun point d’attention.</p>'}

<h2>Contrôle final</h2>
${
  d.finalCheck
    ? `<ul>${d.finalCheck.items
        .map(
          (i) =>
            `<li class="${i.status === 'ok' ? 'ok' : i.status === 'echec' ? 'ko' : 'warn'}"><strong>${esc(i.label)}</strong>${i.detail ? ` — ${esc(i.detail)}` : ''}</li>`,
        )
        .join('')}</ul>${
        d.finalCheck.placeholders.length
          ? `<h3>Emplacements à compléter (${d.finalCheck.placeholders.length})</h3><ul>${d.finalCheck.placeholders.map((p) => `<li>${esc(p.section)} : <mark>${esc(p.text)}</mark></li>`).join('')}</ul>`
          : ''
      }`
    : '<p>Contrôle final non effectué.</p>'
}

<h2>Méthodologie de recherche documentaire</h2>
<p>Bases interrogées (nombre de notices trouvées) : ${
    Object.entries(d.search.connectors)
      .map(([k, v]) => `${esc(k)} ${v}`)
      .join(', ') || 'aucune information'
  }.</p>
${
  d.search.queries.length
    ? t(
        d.search.queries.map((q) => [q.section, q.texte]),
        ['Section', 'Requête'],
      )
    : ''
}

<h2>Livrables</h2>
<ul>${d.deliverables.map((x) => `<li>${esc(x.label)} : ${esc(x.filename)}</li>`).join('')}${d.skipped.map((x) => `<li class="warn">${esc(x.label)} : non produit — ${esc(x.reason)}</li>`).join('')}</ul>

<h2>Charte d’utilisation</h2>
<p>Ce travail a été préparé avec l’aide d’un assistant de recherche et de rédaction. Vous en restez l’auteur responsable : relisez-le, appropriez-vous le contenu, vérifiez les sources clés et respectez les règles de votre établissement concernant l’usage de l’IA (certaines exigent une déclaration d’usage).</p>
<h3>Modèle de déclaration d’usage de l’IA (à adapter)</h3>
<blockquote>${esc(d.aiDeclaration)}</blockquote>
</body></html>`;
}
