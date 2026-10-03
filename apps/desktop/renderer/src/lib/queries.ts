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

const unwrap = async <T>(
  p: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>,
): Promise<T> => {
  const r = await p;
  if (!r.ok) throw r.error;
  return r.value;
};

export const useMissions = () =>
  useQuery({ queryKey: ['missions'], queryFn: () => unwrap(api.missions.list()) });

export const useMission = (id: string | undefined) =>
  useQuery({
    queryKey: ['mission', id],
    enabled: Boolean(id),
    queryFn: () => unwrap(api.missions.get(id!)),
  });

export const useMissionEvents = (id: string | null) =>
  useQuery({
    queryKey: ['events', id],
    queryFn: () => unwrap(api.missions.events(id, { limit: 100 })),
  });

export const usePlan = (id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ['plan', id],
    enabled: Boolean(id) && enabled,
    gcTime: 0,
    queryFn: () => unwrap(api.plan.get(id!)),
  });

export const useSections = (missionId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ['writing', 'sections', missionId],
    enabled: Boolean(missionId) && enabled,
    queryFn: () => unwrap(api.writing.sections(missionId!)),
  });

export const useSection = (nodeId: string | null) =>
  useQuery({
    queryKey: ['writing', 'section', nodeId],
    enabled: Boolean(nodeId),
    gcTime: 0,
    queryFn: () => unwrap(api.writing.section(nodeId!)),
  });

export const useFieldAnalysis = (missionId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ['writing', 'analysis', missionId],
    enabled: Boolean(missionId) && enabled,
    queryFn: () => unwrap(api.writing.analysis(missionId!)),
  });

export const useFrontMatter = (missionId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ['writing', 'front', missionId],
    enabled: Boolean(missionId) && enabled,
    queryFn: () => unwrap(api.writing.frontMatter(missionId!)),
  });

export const useJury = (missionId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ['writing', 'jury', missionId],
    enabled: Boolean(missionId) && enabled,
    queryFn: () => unwrap(api.writing.jury(missionId!)),
  });

export const useVersions = (nodeId: string | null) =>
  useQuery({
    queryKey: ['writing', 'versions', nodeId],
    enabled: Boolean(nodeId),
    gcTime: 0,
    queryFn: () => unwrap(api.writing.versions(nodeId!)),
  });

export const useVersion = (draftId: string | null) =>
  useQuery({
    queryKey: ['writing', 'version', draftId],
    enabled: Boolean(draftId),
    gcTime: 0,
    queryFn: () => unwrap(api.writing.version(draftId!)),
  });
