import { create } from 'zustand';

export type ToastItem = {
  id: number;
  tone: 'success' | 'warning' | 'danger' | 'info';
  title: string;
  description?: string;
};
let n = 0;
export const useToasts = create<{
  items: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: number) => void;
}>((set, get) => ({
  items: [],
  push(t) {
    const id = ++n;
    set({ items: [...get().items, { ...t, id }] });
    setTimeout(() => get().dismiss(id), 6000);
  },
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
}));
