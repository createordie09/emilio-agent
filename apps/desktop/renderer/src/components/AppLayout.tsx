import { Outlet, useNavigate } from 'react-router-dom';
import { BookMarked, Home, Palette, Settings, FolderKanban } from 'lucide-react';
import { AppShell, CreditCard, Sidebar, type NavItem } from '@/components/ui';
import { fr, fmtUsd } from '@/lib/fr';
import { useKeyInfo, useKeyStatus, useMissions } from '@/lib/queries';
import { useUi } from '@/stores/ui';

export function AppLayout() {
  const nav = useNavigate();
  const devMode = useUi((s) => s.devMode);
  const status = useKeyStatus();
  const info = useKeyInfo(Boolean(status.data?.configured));
  const missions = useMissions();

  const items: NavItem[] = [
    { to: '/', label: fr.nav.home, icon: Home, end: true },
    { to: '/missions', label: fr.nav.missions, icon: FolderKanban },
    { to: '/bibliotheque', label: fr.nav.library, icon: BookMarked },
  ];
  const footer: NavItem[] = [
    ...(devMode ? [{ to: '/design', label: fr.nav.design, icon: Palette }] : []),
    { to: '/parametres', label: fr.nav.settings, icon: Settings },
  ];

  const credit = info.data?.accountCreditRemaining ?? info.data?.limitRemaining ?? null;
  const total = info.data && credit !== null ? credit + info.data.usage : null;
  const noKey = status.data && !status.data.configured;

  return (
    <AppShell
      sidebar={(collapsed, toggle) => (
        <Sidebar
          nav={items}
          footerNav={footer}
          recent={missions.data
            ?.slice(0, 5)
            .map((m) => ({ id: m.id, title: m.title, to: `/missions/${m.id}` }))}
          collapsed={collapsed}
          onToggle={toggle}
          onNewMission={() => nav('/missions/nouvelle')}
          credit={
            <CreditCard
              amount={noKey ? '—' : fmtUsd(credit)}
              ratio={
                credit !== null && total ? Math.max(0, Math.min(1, credit / total)) : undefined
              }
              note={
                noKey ? fr.credit.noKey : credit === null ? fr.credit.unknown : fr.credit.remaining
              }
              actionLabel={noKey ? fr.credit.configure : fr.credit.topUp}
              onAction={() =>
                noKey
                  ? nav('/parametres')
                  : window.open('https://openrouter.ai/settings/credits', '_blank')
              }
            />
          }
        />
      )}
    >
      <Outlet />
    </AppShell>
  );
}
