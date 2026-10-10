// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '../renderer/src');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const files = walk(SRC).filter((f) => /\.(tsx?|css)$/.test(f));

describe('garde-fous du design system (CdC §6.1)', () => {
  it('aucune couleur codée en dur hors de tokens.css', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith('tokens.css')) continue;
      const txt = readFileSync(f, 'utf8');
      if (
        /#[0-9a-fA-F]{3,8}\b/.test(txt) ||
        /\b(rgba?|hsla?)\(/.test(txt.replace(/color-mix\([^)]*\)/g, ''))
      )
        offenders.push(relative(SRC, f));
    }
    expect(offenders).toEqual([]);
  });

  it('tokens.css définit chaque variable en clair ET en sombre', () => {
    const css = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');
    const block = (sel: string) => {
      const m = new RegExp(`${sel}\\s*\\{([^}]*)\\}`).exec(css);
      return [...(m?.[1] ?? '').matchAll(/(--[\w-]+)\s*:/g)].map((x) => x[1]);
    };
    const light = new Set(block(':root'));
    const dark = new Set(block('\\.dark'));
    for (const v of light) {
      if (['--focus-ring', '--glass-blur', '--primary-gradient'].includes(v!)) continue;
      expect(dark.has(v!), `${v} manque en mode sombre`).toBe(true);
    }
    for (const required of [
      '--primary',
      '--surface',
      '--text',
      '--border',
      '--success',
      '--warning',
      '--danger',
      '--info',
      '--ink',
    ])
      expect(light.has(required)).toBe(true);
  });

  it('aucun identifiant de modèle réel ni clé API en dur dans le renderer', () => {
    const bad = /(sk-or-v1-[A-Za-z0-9]{8,}|anthropic\/|openai\/|google\/gemini|meta-llama\/)/;
    const offenders = files
      .filter((f) => bad.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('polices embarquées localement (aucune URL distante)', () => {
    const css =
      readFileSync(join(SRC, 'styles/globals.css'), 'utf8') +
      readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).toMatch(/@fontsource\/poppins/);
    expect(css).toMatch(/@fontsource\/inter/);
    expect(css).toMatch(/@fontsource\/source-serif-4/);
  });
});
