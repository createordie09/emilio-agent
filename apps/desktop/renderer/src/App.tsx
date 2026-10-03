import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { ToastHost } from '@/components/ToastHost';
import { HomePage } from '@/pages/HomePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { DesignPage } from '@/pages/DesignPage';
import { SoonPage } from '@/pages/SoonPage';
import { MissionsPage } from '@/pages/MissionsPage';
import { PlanPage } from '@/pages/PlanPage';
import { MissionPage } from '@/pages/MissionPage';
import { NewMissionPage } from '@/pages/NewMissionPage';
import { WizardPage } from '@/pages/wizard/WizardPage';
import { useLiveSync } from '@/lib/live';
import { useUi } from '@/stores/ui';

export function App() {
  useLiveSync();
  const devMode = useUi((s) => s.devMode);
  const loaded = useUi((s) => s.loaded);
  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="missions" element={<MissionsPage />} />
          <Route path="missions/nouvelle" element={<NewMissionPage />} />
          <Route path="missions/nouvelle/:draftId" element={<WizardPage />} />
          <Route path="missions/:id" element={<MissionPage />} />
          <Route path="missions/:id/plan" element={<PlanPage />} />
          <Route path="bibliotheque" element={<SoonPage title="Bibliothèque de sources" />} />
          <Route path="parametres" element={<SettingsPage />} />
          {/* Page de démonstration du design system : mode développeur uniquement (CdC §6.1.10). */}
          <Route
            path="design"
            element={loaded && !devMode ? <Navigate to="/" replace /> : <DesignPage />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <ToastHost />
    </>
  );
}
