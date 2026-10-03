import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Statut de la clé (masquée) — jamais la clé elle-même. */
export const useKeyStatus = () =>
  useQuery({
    queryKey: ['key-status'],
    queryFn: async () => {
      const r = await api.key.status();
      if (!r.ok) throw r.error;
      return r.value;
    },
  });

/** Informations de crédit : appel réseau (via le moteur) rafraîchi toutes les 10 min (CdC §6.3). */
export const useKeyInfo = (enabled: boolean) =>
  useQuery({
    queryKey: ['key-info'],
    enabled,
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const r = await api.key.test();
      if (!r.ok) throw r.error;
      return r.value;
    },
  });

export const useModels = () =>
  useQuery({
    queryKey: ['models'],
    staleTime: 60 * 60_000,
    retry: false,
    queryFn: async () => {
      const r = await api.models.list();
      if (!r.ok) throw r.error;
      return r.value;
    },
  });
