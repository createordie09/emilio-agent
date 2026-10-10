// Types minimaux pour import.meta.glob (résolu par Vite / Vitest au build).
interface ImportMeta {
  glob<T = unknown>(
    pattern: string,
    options?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, T>;
}
