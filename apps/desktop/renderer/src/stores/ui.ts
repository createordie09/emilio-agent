import { create } from 'zustand';
import type { ThemePreference, UiSettings } from '@emilio/shared';
import { api } from '@/lib/api';

type UiState = UiSettings & {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<UiSettings>) => Promise<void>;
};

const systemDark = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

export function applyTheme(theme: ThemePreference, reduceEffects: boolean): void {
  const root = document.documentElement;
  const dark = theme === 'sombre' || (theme === 'systeme' && systemDark());
  root.classList.toggle('dark', dark);
  root.classList.toggle('reduce-effects', reduceEffects);
}

export const useUi = create<UiState>((set, get) => ({
  theme: 'systeme',
  reduceEffects: false,
  devMode: false,
  loaded: false,
  async load() {
    const r = await api.ui.get();
    if (r.ok) {
      set({ ...r.value, loaded: true });
      applyTheme(r.value.theme, r.value.reduceEffects);
    } else {
      set({ loaded: true });
    }
  },
  async update(patch) {
    const prev = get();
    set(patch);
    applyTheme(patch.theme ?? prev.theme, patch.reduceEffects ?? prev.reduceEffects);
    const r = await api.ui.set(patch);
    if (r.ok) set(r.value);
  },
}));
