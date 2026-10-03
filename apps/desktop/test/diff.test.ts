import { describe, it, expect } from 'vitest';
import { diffSentences } from '../renderer/src/lib/diff';

describe('diff par phrases', () => {
  it('distingue phrases communes, ajoutées et supprimées', () => {
    const d = diffSentences('Un. Deux. Trois.', 'Un. Quatre. Trois.');
    expect(d.map((p) => p.kind)).toEqual(['same', 'removed', 'added', 'same']);
    expect(d[1]!.text).toBe('Deux.');
    expect(d[2]!.text).toBe('Quatre.');
  });
  it('textes identiques : aucune différence', () => {
    expect(diffSentences('A. B.', 'A. B.').every((p) => p.kind === 'same')).toBe(true);
  });
});
