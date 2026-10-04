import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import type { ExportConfig } from './config';

type VegaBar = {
  data?: { values?: Record<string, string | number>[] };
  encoding?: { x?: { field?: string }; y?: { field?: string } };
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString().replace('.', ',');
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Histogramme vertical en SVG, dessiné par le code à partir des valeurs calculées (spécification Vega-Lite de P4). */
export function barChartSvg(
  spec: Record<string, unknown>,
  cfg: ExportConfig['charts'],
): string | null {
  const s = spec as VegaBar;
  const xf = s.encoding?.x?.field;
  const yf = s.encoding?.y?.field;
  const rows = s.data?.values ?? [];
  if (!xf || !yf || !rows.length) return null;
  const vals = rows.map((r) => ({ label: String(r[xf] ?? ''), v: Number(r[yf] ?? 0) }));
  const { width: W, height: H } = cfg;
  const m = { l: 56, r: 16, t: 20, b: 78 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const max = Math.max(...vals.map((x) => x.v), 1);
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const slot = pw / vals.length;
  const bw = Math.min(56, slot * 0.7);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#FFFFFF"/>`,
  ];
  for (let i = 0; i <= 4; i++) {
    const y = m.t + ph - (ph * i) / 4;
    parts.push(
      `<line x1="${m.l}" y1="${y}" x2="${W - m.r}" y2="${y}" stroke="${cfg.gridColor}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${m.l - 6}" y="${y + 4}" font-family="Inter" font-size="11" fill="${cfg.textColor}" text-anchor="end">${esc(fmt((top * i) / 4))}</text>`,
    );
  }
  vals.forEach((x, i) => {
    const h = (ph * x.v) / top;
    const cx = m.l + slot * i + slot / 2;
    parts.push(
      `<rect x="${cx - bw / 2}" y="${m.t + ph - h}" width="${bw}" height="${h}" fill="${cfg.barColor}"/>`,
    );
    parts.push(
      `<text x="${cx}" y="${m.t + ph - h - 5}" font-family="Inter" font-size="11" fill="${cfg.textColor}" text-anchor="middle">${esc(fmt(x.v))}</text>`,
    );
    parts.push(
      `<text transform="translate(${cx} ${m.t + ph + 14}) rotate(-30)" font-family="Inter" font-size="11" fill="${cfg.textColor}" text-anchor="end">${esc(clip(x.label, 22))}</text>`,
    );
  });
  parts.push(
    `<line x1="${m.l}" y1="${m.t + ph}" x2="${W - m.r}" y2="${m.t + ph}" stroke="${cfg.textColor}" stroke-width="1"/>`,
    '</svg>',
  );
  return parts.join('');
}

/** Rastérise le SVG en PNG (polices embarquées : aucun accès aux polices du système, résultat identique partout). */
export function svgToPng(
  svg: string,
  resourcesDir: string | undefined,
  cfg: ExportConfig['charts'],
): Uint8Array | null {
  try {
    const fonts = resourcesDir
      ? [cfg.fontFile, cfg.boldFontFile]
          .map((f) => join(resourcesDir, f))
          .filter((f) => existsSync(f))
      : [];
    const r = new Resvg(svg, {
      fitTo: { mode: 'zoom', value: 2 },
      font: { fontFiles: fonts, loadSystemFonts: fonts.length === 0, defaultFontFamily: 'Inter' },
    });
    return new Uint8Array(r.render().asPng());
  } catch {
    return null;
  }
}
