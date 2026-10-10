import { describe, it, expect } from 'vitest';
import {
  chiSquareSf,
  studentTwoSidedP,
  lnGamma,
  makeTable,
  describeNumeric,
  frequencies,
  crosstab,
  pearson,
  groupMeans,
} from '../src';

const near = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('lois de probabilité (calcul par du code, §9 P4)', () => {
  it('ln Γ : valeurs exactes connues', () => {
    near(lnGamma(5), Math.log(24), 1e-10);
    near(lnGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-10);
  });
  it('khi-deux : valeurs critiques à 5 % (tables)', () => {
    near(chiSquareSf(3.8415, 1), 0.05, 1e-4);
    near(chiSquareSf(5.9915, 2), 0.05, 1e-4);
    near(chiSquareSf(9.4877, 4), 0.05, 1e-4);
    near(chiSquareSf(6.6349, 1), 0.01, 1e-4);
    expect(chiSquareSf(0, 3)).toBe(1);
  });
  it('Student : valeurs critiques bilatérales à 5 % (tables)', () => {
    near(studentTwoSidedP(2.0484, 28), 0.05, 1e-4);
    near(studentTwoSidedP(2.2281, 10), 0.05, 1e-4);
    near(studentTwoSidedP(0, 12), 1, 1e-12);
    near(studentTwoSidedP(12, 60), 0, 1e-6);
  });
});

describe('statistiques descriptives', () => {
  const t = makeTable(
    ['x', 'groupe', 'oui_non'],
    [
      ['2', 'A', 'oui'],
      ['4', 'A', 'non'],
      ['4', 'B', 'oui'],
      ['4', 'B', 'oui'],
      ['5', 'A', 'non'],
      ['5', 'B', 'NA'],
      ['7', 'B', 'oui'],
      ['9', 'A', 'oui'],
      ['', 'A', 'non'],
    ],
  );
  it('moyenne, médiane, écart-type d’échantillon, manquants', () => {
    const d = describeNumeric(t, 'x');
    expect(d).toMatchObject({ n: 8, missing: 1, mean: 5, median: 4.5, min: 2, max: 9 });
    near(d.sd, Math.sqrt(32 / 7), 1e-9);
  });
  it('nombres à la française (virgule, espace insécable) et manquants usuels', () => {
    const t2 = makeTable(['v'], [['1 200,5'], ['800,5'], ['NA'], ['n.d.'], ['']]);
    const d = describeNumeric(t2, 'v');
    expect(d.n).toBe(2);
    expect(d.mean).toBe(1000.5);
    expect(d.missing).toBe(3);
  });
  it('effectifs et pourcentages sur les réponses valides ; modalités numériques triées', () => {
    const f = frequencies(t, 'oui_non');
    expect(f.n).toBe(8);
    expect(f.missing).toBe(1);
    expect(f.rows[0]).toEqual({ value: 'oui', count: 5, pct: 62.5 });
    const g = frequencies(makeTable(['n'], [['3'], ['1'], ['2'], ['1']]), 'n');
    expect(g.rows.map((r) => r.value)).toEqual(['1', '2', '3']);
  });
  it('moyennes par groupe', () => {
    const g = groupMeans(t, 'x', 'groupe');
    expect(g.groups.find((x) => x.group === 'B')).toMatchObject({ n: 4, mean: 5 });
    expect(g.groups.find((x) => x.group === 'A')!.n).toBe(4);
  });
});

describe('tableau croisé, khi-deux et corrélation', () => {
  it('2×2 connu : khi-deux = 0,7937, ddl 1, p = 0,373', () => {
    const rows: string[][] = [];
    const add = (a: string, b: string, n: number) => {
      for (let i = 0; i < n; i++) rows.push([a, b]);
    };
    add('a1', 'b1', 10);
    add('a1', 'b2', 20);
    add('a2', 'b1', 30);
    add('a2', 'b2', 40);
    const c = crosstab(makeTable(['A', 'B'], rows), 'A', 'B');
    expect(c.n).toBe(100);
    expect(c.counts).toEqual([
      [10, 20],
      [30, 40],
    ]);
    near(c.chi2!.statistic, 0.7937, 1e-3);
    expect(c.chi2!.df).toBe(1);
    near(c.chi2!.p, 0.373, 2e-3);
    near(c.chi2!.cramersV, Math.sqrt(0.7937 / 100), 1e-3);
    expect(c.chi2!.reliable).toBe(true);
    near(c.rowPct[0]![0]!, (100 * 10) / 30, 1e-9);
  });
  it('effectifs théoriques faibles : test signalé comme peu fiable', () => {
    const t = makeTable(
      ['A', 'B'],
      [
        ['x', 'u'],
        ['x', 'v'],
        ['y', 'u'],
        ['y', 'u'],
      ],
    );
    expect(crosstab(t, 'A', 'B').chi2!.reliable).toBe(false);
  });
  it('Pearson : r = 0,7746, t = 2,121, p ≈ 0,124 (n = 5)', () => {
    const t = makeTable(
      ['x', 'y'],
      [
        ['1', '2'],
        ['2', '4'],
        ['3', '5'],
        ['4', '4'],
        ['5', '5'],
      ],
    );
    const r = pearson(t, 'x', 'y')!;
    near(r.r, 0.7746, 1e-3);
    near(r.t, 2.121, 2e-3);
    near(r.p, 0.124, 3e-3);
    expect(r).toMatchObject({ n: 5, df: 3, strength: 'forte', direction: 'positive' });
  });
  it('corrélation parfaite, constante et échantillon trop petit', () => {
    const lin = makeTable(
      ['x', 'y'],
      [
        ['1', '2'],
        ['2', '4'],
        ['3', '6'],
      ],
    );
    expect(pearson(lin, 'x', 'y')).toMatchObject({ r: 1, p: 0 });
    const cst = makeTable(
      ['x', 'y'],
      [
        ['1', '5'],
        ['2', '5'],
        ['3', '5'],
      ],
    );
    expect(pearson(cst, 'x', 'y')).toBeNull();
    expect(
      pearson(
        makeTable(
          ['x', 'y'],
          [
            ['1', '1'],
            ['2', '2'],
          ],
        ),
        'x',
        'y',
      ),
    ).toBeNull();
  });
});
