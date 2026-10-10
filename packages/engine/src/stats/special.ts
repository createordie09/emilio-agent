/** Fonctions spéciales pour les lois du khi-deux et de Student (calcul par du code, jamais par un modèle, CdC §9 P4, §17). */

/** ln Γ(x) — approximation de Lanczos (g = 7, n = 9), précision ≈ 1e-13 pour x > 0. */
export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  const xx = x - 1;
  let a = c[0]!;
  const t = xx + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i]! / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

const EPS = 1e-14;
const TINY = 1e-300;

/** Fonction gamma incomplète régularisée supérieure Q(a, x) = Γ(a, x) / Γ(a). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    // Série pour P(a, x), puis Q = 1 − P.
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * EPS) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // Fraction continue (Lentz) pour Q(a, x).
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** Fonction bêta incomplète régularisée I_x(a, b). */
export function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = lnGamma(a + b) - lnGamma(a) - lnGamma(b);
  const front = Math.exp(lbeta + a * Math.log(x) + b * Math.log(1 - x));
  const cf = (xv: number, av: number, bv: number): number => {
    const qab = av + bv;
    const qap = av + 1;
    const qam = av - 1;
    let c = 1;
    let d = 1 - (qab * xv) / qap;
    if (Math.abs(d) < TINY) d = TINY;
    d = 1 / d;
    let h = d;
    for (let m = 1; m < 1000; m++) {
      const m2 = 2 * m;
      let aa = (m * (bv - m) * xv) / ((qam + m2) * (av + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c;
      if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      h *= d * c;
      aa = (-(av + m) * (qab + m) * xv) / ((av + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c;
      if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  };
  return x < (a + 1) / (a + b + 2) ? (front * cf(x, a, b)) / a : 1 - (front * cf(1 - x, b, a)) / b;
}

/** P(X > x) pour une loi du khi-deux à `df` degrés de liberté. */
export const chiSquareSf = (x: number, df: number): number => gammaQ(df / 2, x / 2);

/** p-valeur bilatérale d'une statistique t de Student à `df` degrés de liberté. */
export const studentTwoSidedP = (t: number, df: number): number =>
  betaI(df / (df + t * t), df / 2, 0.5);
