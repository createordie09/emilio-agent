import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Relie les événements poussés par le moteur au cache de requêtes : chaque mise à jour rafraîchit les listes
 * (regroupées sur 150 ms pour rester fluide pendant une mission, ENF-01).
 */
export function useLiveSync(): void {
  const qc = useQueryClient();
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      void qc.invalidateQueries({ queryKey: ['missions'] });
      void qc.invalidateQueries({ queryKey: ['mission'] });
      void qc.invalidateQueries({ queryKey: ['events'] });
    };
    const off = api.onEvent(() => {
      timer ??= setTimeout(flush, 150);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [qc]);
}
