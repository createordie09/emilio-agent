import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { ToastHost } from '@/components/ToastHost';
import { HomePage } from '@/pages/HomePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { DesignPage } from '@/pages/DesignPage';
import { SoonPage } from '@/pages/SoonPage';
import { useUi } from '@/stores/ui';

export function App() {
  const devMode = useUi((s) => s.devMode);
  const loaded = useUi((s) => s.loaded);
  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="missions" element={<SoonPage title="Mes missions" />} />
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
