/** Masque une clé : `sk-or-v1…xxxx` (CdC §14.6). Seule forme autorisée dans les journaux et le renderer. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 12) return '••••';
  return `${k.slice(0, 8)}…${k.slice(-4)}`;
}
