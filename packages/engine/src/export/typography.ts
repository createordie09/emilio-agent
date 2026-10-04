/**
 * Typographie française appliquée par le code (CdC §15.4) : espaces insécables avant « : ; ! ? % » et à l'intérieur des guillemets,
 * guillemets « » à la place des guillemets droits, apostrophes typographiques.
 */
const NBSP = '\u00a0';
const NNBSP = '\u202f';

export function frenchTypography(input: string): string {
  let t = input;
  // Apostrophes entre deux lettres.
  t = t.replace(/(\p{L})'(\p{L})/gu, '$1’$2');
  // Guillemets droits appariés → « … » (hors texte déjà converti).
  let open = true;
  t = t.replace(/"/g, () => {
    const r = open ? '«' : '»';
    open = !open;
    return r;
  });
  // Espaces dans les guillemets français.
  t = t.replace(/«\s*/g, `«${NBSP}`).replace(/\s*»/g, `${NBSP}»`);
  // Espace avant la ponctuation haute : fine insécable pour ; ! ? et insécable pour « : » (hors heures, URL et ratios).
  t = t.replace(/\s*([;!?])(?=\s|$|[)»"”])/g, `${NNBSP}$1`);
  t = t.replace(/(?<!\d)\s*:(?!\/\/)(?=\s|$)/g, `${NBSP}:`);
  t = t.replace(/(\d)\s+%/g, `$1${NNBSP}%`);
  // Pas d'espace avant un point ou une virgule.
  t = t.replace(/\s+([.,])(?=\s|$)/g, '$1');
  return t;
}
