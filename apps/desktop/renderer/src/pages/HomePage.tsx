import { useNavigate } from 'react-router-dom';
import { Coins, FolderKanban, Wallet, Rocket, KeyRound } from 'lucide-react';
import {
  WelcomeBanner,
  KpiCard,
  EmptyState,
  Button,
  Illustration,
  IconBubble,
  NoticeList,
} from '@/components/ui';
import { fmtUsd } from '@/lib/fr';
import { useKeyInfo, useKeyStatus } from '@/lib/queries';

const today = () =>
  new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

/** Accueil provisoire (J1) : bannière, indicateurs réels de la clé, état vide. Les missions arrivent en J2/J3. */
export function HomePage() {
  const nav = useNavigate();
  const status = useKeyStatus();
  const info = useKeyInfo(Boolean(status.data?.configured));
  const credit = info.data?.accountCreditRemaining ?? info.data?.limitRemaining ?? null;
  const noKey = status.data && !status.data.configured;

  return (
    <div className="space-y-8 p-8">
      <WelcomeBanner
        date={today().replace(/^./, (c) => c.toUpperCase())}
        title="Bonjour !"
        subtitle="Confiez la recherche et la rédaction de votre mémoire à votre équipe d'agents IA."
        illustration={<Illustration size={128} />}
      />
      <section className="space-y-4">
        <h2 className="t-h2">Vue d'ensemble</h2>
        <div className="grid grid-cols-3 gap-4">
          <KpiCard
            icon={<IconBubble icon={FolderKanban} size={48} />}
            value="0"
            label="Missions en cours"
          />
          <KpiCard
            icon={<IconBubble icon={Wallet} size={48} />}
            value={noKey ? '—' : fmtUsd(credit)}
            label="Crédit OpenRouter"
            active
          />
          <KpiCard
            icon={<IconBubble icon={Coins} size={48} />}
            value={info.data ? fmtUsd(info.data.usage) : '—'}
            label="Coût total dépensé"
          />
        </div>
      </section>
      {noKey && (
        <NoticeList
          title="À faire pour commencer"
          items={[
            {
              id: 'key',
              title: 'Ajoutez votre clé OpenRouter',
              text: "Vos agents utilisent votre propre clé OpenRouter. Elle est chiffrée sur votre ordinateur et ne quitte jamais l'application.",
            },
          ]}
          onSeeAll={() => nav('/parametres')}
        />
      )}
      <EmptyState
        icon={Rocket}
        title="Aucune mission pour l'instant"
        text="La création de missions arrive dans un prochain jalon. En attendant, configurez votre clé et vos modèles."
        action={
          <Button onClick={() => nav('/parametres')}>
            <KeyRound className="size-4" />
            Ouvrir les paramètres
          </Button>
        }
      />
    </div>
  );
}
