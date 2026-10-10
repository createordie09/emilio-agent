/**
 * Pseudonymisation (CdC §19, option d'anonymisation) : les noms propres d'un texte (transcription d'entretien, notes) sont remplacés par
 * des identifiants E1, E2… avant tout envoi à un modèle ; la table de correspondance reste sur l'ordinateur.
 * Les e-mails et numéros de téléphone sont masqués dans tous les cas.
 */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EMAIL = /[^\s@<>(),;:]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// Numéros : +229 97 00 00 00, 01 97 00 00 00, 97.00.00.00, 0033 6 12 34 56 78 (au moins 8 chiffres, séparateurs usuels).
const PHONE = /(?<![\d/])(?:\+|00)?\d(?:[\s.-]?\d){7,13}(?![\d/])/g;

export function scrubContacts(text: string): string {
  return text
    .replace(EMAIL, '[e-mail masqué]')
    .replace(PHONE, (m) =>
      /^\d{4}-\d{2}-\d{2}$/.test(m) || /^\d{4}$/.test(m) ? m : '[numéro masqué]',
    );
}

export class Pseudonymizer {
  private map = new Map<string, string>();
  private n = 0;

  /** Enregistre des noms (nom complet, prénom, nom de famille…) : chaque personne reçoit un identifiant, ses variantes aussi. */
  register(person: string | string[]): string {
    const names = (Array.isArray(person) ? person : [person])
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
    const known = names.map((x) => this.map.get(x.toLowerCase())).find(Boolean);
    const id = known ?? `E${++this.n}`;
    for (const x of names) this.map.set(x.toLowerCase(), id);
    return id;
  }

  /** Remplace chaque nom enregistré (mot entier, sans tenir compte de la casse ni des accents de casse), les plus longs d'abord. */
  apply(text: string): string {
    const names = [...this.map.keys()].sort((a, b) => b.length - a.length);
    let out = text;
    for (const k of names) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(k)}(?![\\p{L}\\p{N}])`, 'giu');
      out = out.replace(re, this.map.get(k)!);
    }
    return scrubContacts(out);
  }

  /** Table de correspondance E1 → noms (reste locale). */
  mapping(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [name, id] of this.map) (out[id] ??= []).push(name);
    return out;
  }
}
