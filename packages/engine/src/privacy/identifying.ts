/**
 * Données personnelles dans les données de terrain (CdC §19, J10) : détection des colonnes d'identification
 * (nom, téléphone, e-mail, adresse, numéros d'identité…). Ces colonnes n'ont aucune utilité statistique : elles sont
 * **exclues d'office** de l'analyse et ne sont jamais envoyées au modèle (ni noms de modalités, ni valeurs, ni échantillon).
 */
const strip = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Mots (après normalisation) qui désignent une donnée identifiante quand ils figurent dans l'intitulé d'une colonne. */
const NAME_TOKENS = new Set([
  'nom',
  'noms',
  'prenom',
  'prenoms',
  'name',
  'surname',
  'firstname',
  'lastname',
  'fullname',
  'telephone',
  'tel',
  'phone',
  'mobile',
  'portable',
  'whatsapp',
  'gsm',
  'email',
  'mail',
  'courriel',
  'adresse',
  'address',
  'domicile',
  'matricule',
  'identifiant',
  'cni',
  'npi',
  'passeport',
  'ifu',
  'rccm',
  'iban',
  'rib',
  'gps',
  'latitude',
  'longitude',
  'coordonnees',
  'naissance',
  'signature',
]);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d\s.\-()]{8,20}$/;
const digits = (s: string): number => (s.match(/\d/g) ?? []).length;

export type IdentifyingVerdict = { identifying: boolean; reason: string | null };

/** `name` : intitulé de la colonne ; `values` : valeurs non vides (le contenu complète l'intitulé : colonne mal nommée). */
export function detectIdentifying(name: string, values: string[]): IdentifyingVerdict {
  const tokens = strip(name)
    .split(/[^a-z]+/)
    .filter(Boolean);
  const hit = tokens.find((t) => NAME_TOKENS.has(t));
  if (hit) return { identifying: true, reason: `l'intitulé contient « ${hit} »` };
  const present = values.map((v) => v.trim()).filter(Boolean);
  if (present.length >= 5) {
    const share = (f: (v: string) => boolean) => present.filter(f).length / present.length;
    if (share((v) => EMAIL.test(v)) >= 0.6) return { identifying: true, reason: 'adresses e-mail' };
    if (share((v) => PHONE.test(v) && digits(v) >= 8) >= 0.6)
      return { identifying: true, reason: 'numéros de téléphone' };
    const distinct = new Set(present).size;
    if (
      present.length >= 20 &&
      distinct === present.length &&
      present.every(
        (v) => /^[A-Za-z0-9][A-Za-z0-9\-_/]{5,}$/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v),
      )
    )
      return { identifying: true, reason: 'codes d’identification uniques' };
  }
  return { identifying: false, reason: null };
}
