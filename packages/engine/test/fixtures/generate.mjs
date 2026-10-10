// Régénère les fichiers d'exemple des tests (PDF, DOCX, CSV, XLSX). Les sorties sont versionnées :
//   node test/fixtures/generate.mjs   (nécessite Chromium de Playwright pour les PDF)
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(join(here, '../../../../apps/desktop/node_modules/@playwright/test'));
const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx');
const ExcelJS = require('exceljs');

// --- texte déterministe sur la microfinance au Bénin ---------------------------------------
const S = [
  "La microfinance joue un rôle central dans l'inclusion financière des ménages ruraux du Bénin.",
  "Les institutions de microfinance offrent des services de crédit et d'épargne adaptés aux petites activités génératrices de revenus.",
  "Plusieurs auteurs soulignent que l'accès au crédit améliore la productivité des exploitations agricoles familiales.",
  "Le taux de remboursement constitue un indicateur essentiel de la viabilité d'une institution de microfinance.",
  "Les groupes de caution solidaire réduisent l'asymétrie d'information entre l'institution et les emprunteurs.",
  "La proximité géographique des agences facilite la collecte de l'épargne dans les zones éloignées des centres urbains.",
  'Les femmes représentent la majorité des bénéficiaires de microcrédit dans les départements du nord du pays.',
  "La régulation de l'UEMOA encadre l'activité des systèmes financiers décentralisés dans l'ensemble de la sous-région.",
  'Le financement de la campagne agricole dépend fortement de la saisonnalité des revenus des producteurs de coton.',
  "L'éducation financière contribue à une meilleure utilisation des services et à la réduction du surendettement.",
];
const para = (seed, n = 6) =>
  Array.from({ length: n }, (_, i) => S[(seed * 3 + i * 7) % S.length]).join(' ');
const PAGES = [
  ['1. Introduction', [para(1, 7), para(2, 7), para(3, 6)]],
  ['2. Revue de littérature', [para(4, 8), para(5, 8), para(6, 7)]],
  ['2.1 Cadre théorique', [para(7, 8), para(8, 8), para(9, 7)]],
  ['3. Méthodologie', [para(10, 8), para(11, 8), para(12, 7)]],
  ['4. Résultats', [para(13, 8), para(14, 8), para(15, 7)]],
  ['5. Discussion', [para(16, 8), para(17, 8), para(18, 7)]],
  ['Conclusion', [para(19, 7), para(20, 6)]],
  [
    'Bibliographie',
    [
      'Armendariz, B. et Morduch, J. (2010). The Economics of Microfinance. MIT Press.',
      'Banerjee, A. et Duflo, E. (2011). Repenser la pauvreté. Seuil.',
      'Gentil, D. et Servet, J.-M. (2002). Les Microfinances en Afrique. Revue Tiers Monde.',
    ],
  ],
];

const html = (
  title,
  header,
  footerLabel,
) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 28mm 22mm; }
  body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; }
  .pg { page-break-after: always; position: relative; }
  .hd { position: absolute; top: -20mm; left: 0; right: 0; font-size: 9pt; color: #555; border-bottom: 1px solid #aaa; }
  .ft { position: absolute; bottom: -20mm; left: 0; right: 0; text-align: center; font-size: 9pt; }
  h2 { font-size: 15pt; margin: 0 0 8pt; }
</style></head><body>${PAGES.map(
  ([h, ps], i) => `<div class="pg" style="height:230mm">
  <div class="hd">${header}</div><h2>${h}</h2>${ps.map((p) => `<p>${p}</p>`).join('')}<div class="ft">${footerLabel(i + 1)}</div></div>`,
).join('')}</body></html>`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setContent(
  html('Mémoire', "Université d'Abomey-Calavi — Mémoire de master en économie", (n) => `Page ${n}`),
);
writeFileSync(
  join(here, 'memoire-exemple.pdf'),
  await page.pdf({ format: 'A4', printBackground: true }),
);
// PDF « scanné » : uniquement une image, aucun texte.
await page.setContent(
  '<body><div style="width:600px;height:800px;background:repeating-linear-gradient(#ccc,#ccc 2px,#fff 2px,#fff 14px)"></div></body>',
);
writeFileSync(join(here, 'scan.pdf'), await page.pdf({ format: 'A4', printBackground: true }));
await browser.close();

// --- DOCX : guide de rédaction de l'établissement ---------------------------------------------
const doc = new Document({
  sections: [
    {
      children: [
        new Paragraph({ text: 'Guide de rédaction des mémoires', heading: HeadingLevel.TITLE }),
        new Paragraph({ text: '1. Présentation matérielle', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          children: [
            new TextRun(
              'Le mémoire est rédigé en police Times New Roman, taille 12, interligne 1,5. Les marges sont de 2,5 cm.',
            ),
          ],
        }),
        new Paragraph({ text: '2. Structure', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          children: [
            new TextRun(
              'Le mémoire comporte entre 60 et 90 pages hors annexes, une introduction, deux parties et une conclusion.',
            ),
          ],
        }),
      ],
    },
  ],
});
writeFileSync(join(here, 'guide-redaction.docx'), await Packer.toBuffer(doc));

// --- données de terrain : CSV (séparateur « ; », décimales françaises) et XLSX ----------------
const rnd = (() => {
  let s = 42;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
})();
const rows = Array.from({ length: 60 }, (_, i) => {
  const age = 20 + Math.floor(rnd() * 40);
  return [
    `R${String(i + 1).padStart(3, '0')}`,
    age,
    rnd() < 0.55 ? 'Femme' : 'Homme',
    ['Parakou', 'Natitingou', 'Cotonou', 'Bohicon'][Math.floor(rnd() * 4)],
    (50000 + Math.floor(rnd() * 400000)).toString(),
    (rnd() * 5).toFixed(1).replace('.', ','),
    1 + Math.floor(rnd() * 5),
    rnd() < 0.7 ? 'Oui' : 'Non',
    i % 9 === 0 ? '' : `Commentaire ${i}`,
  ];
});
const head = [
  'Identifiant',
  'Age',
  'Sexe',
  'Ville',
  'Revenu mensuel (FCFA)',
  'Taux de remboursement',
  'Satisfaction (1-5)',
  'Credit obtenu',
  'Remarque',
];
writeFileSync(
  join(here, 'donnees-enquete.csv'),
  '﻿' + [head, ...rows].map((r) => r.join(';')).join('\n') + '\n',
);
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Enquête');
ws.addRow(head);
for (const r of rows)
  ws.addRow([
    r[0],
    r[1],
    r[2],
    r[3],
    Number(r[4]),
    Number(String(r[5]).replace(',', '.')),
    r[6],
    r[7],
    r[8],
  ]);
wb.addWorksheet('Notes').addRow(['Données fictives pour les tests']);
await wb.xlsx.writeFile(join(here, 'donnees-enquete.xlsx'));
console.log('fixtures générées');
