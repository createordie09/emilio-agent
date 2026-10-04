import * as React from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { Button, Checkbox, Logo, Stepper, Switch } from '@/components/ui';
import { api } from '@/lib/api';
import { useKeyStatus, usePrefs } from '@/lib/queries';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

const STEPS = ['Bienvenue', 'Confidentialité', 'Clé OpenRouter', 'Charte'];

/** Premier lancement (CdC J9) : présentation, confidentialité (§19), clé, charte d'utilisation (§17.5). Bloquant jusqu'à l'acceptation de la charte. */
export function Onboarding() {
  const { data: prefs } = usePrefs();
  const key = useKeyStatus();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [step, setStep] = React.useState(0);
  const [accepted, setAccepted] = React.useState(false);
  const [deny, setDeny] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  if (!prefs || prefs.onboardingDone) return null;

  const finish = async (toSettings: boolean) => {
    setBusy(true);
    await api.ops.setPrefs({ onboardingDone: true, denyDataCollection: deny });
    await qc.invalidateQueries({ queryKey: ['prefs'] });
    setBusy(false);
    if (toSettings) nav('/parametres');
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bienvenue"
      className="fixed inset-0 z-50 grid place-items-center bg-bg p-6"
    >
      <div className="w-full max-w-2xl space-y-6 rounded-xl border border-border bg-surface p-8 shadow-lg">
        <div className="flex items-center justify-between">
          <Logo collapsed={false} />
          <span className="t-caption text-text-subtle">
            Étape {step + 1} sur {STEPS.length}
          </span>
        </div>
        <Stepper steps={STEPS} current={step} />

        {step === 0 && (
          <section className="space-y-3" aria-label="Bienvenue">
            <h1 className="t-h1">Bienvenue dans emilio agent</h1>
            <p className="t-body text-text-muted">
              emilio agent est un assistant de recherche et de rédaction académique. À partir de
              votre sujet, de vos documents et de vos données, des agents d’IA cherchent des
              sources, rédigent, relisent comme un jury, puis vous remettent un mémoire (Word, PDF),
              un diaporama de soutenance et un rapport.
            </p>
            <ul className="t-small list-disc space-y-1 pl-5 text-text-muted">
              <li>
                L’agent n’invente jamais une source, une citation ou une donnée de terrain : tout ce
                qui manque est signalé.
              </li>
              <li>
                Vous pouvez mettre la mission en pause, la reprendre et suivre son coût à tout
                moment.
              </li>
              <li>
                Tout fonctionne sur votre ordinateur ; seuls des extraits de texte partent vers le
                service d’IA que vous choisissez.
              </li>
            </ul>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-4" aria-label="Confidentialité">
            <h2 className="t-h2">Vos données et la confidentialité</h2>
            <p className="t-body text-text-muted">
              Vos fichiers restent sur votre ordinateur, <strong>sauf les extraits de texte</strong>{' '}
              envoyés aux modèles d’IA via OpenRouter pour rédiger et vérifier. OpenRouter transmet
              ces extraits au fournisseur du modèle choisi ; chaque fournisseur a sa propre
              politique de conservation des données.
            </p>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div>
                <p className="t-small font-medium">
                  Refuser les fournisseurs qui conservent mes données
                </p>
                <p className="t-caption text-text-muted">
                  Recommandé pour des données sensibles. Certains modèles peuvent alors devenir
                  indisponibles. Modifiable à tout moment dans les paramètres.
                </p>
              </div>
              <Switch
                checked={deny}
                onCheckedChange={setDeny}
                label="Refuser les fournisseurs qui conservent mes données"
              />
            </div>
            <p className="t-small">
              <a
                href="https://openrouter.ai/privacy"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary-strong underline"
              >
                Politique de confidentialité d’OpenRouter <ExternalLink className="size-3.5" />
              </a>
            </p>
            <p className="t-caption text-text-subtle">
              emilio agent n’envoie aucune statistique d’usage : il n’y a pas de télémétrie.
            </p>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-3" aria-label="Clé OpenRouter">
            <h2 className="t-h2">Votre clé OpenRouter</h2>
            <p className="t-body text-text-muted">
              L’application utilise votre propre compte OpenRouter : vous payez uniquement ce que
              vous consommez, et vous fixez un budget maximal pour chaque mission. La clé est
              chiffrée sur votre ordinateur et n’est jamais affichée en entier.
            </p>
            {key.data?.configured ? (
              <p className="t-small flex items-center gap-2 text-success">
                <ShieldCheck className="size-4" aria-hidden /> Une clé est déjà enregistrée.
              </p>
            ) : (
              <p className="t-small text-text-muted">
                Vous pouvez l’ajouter maintenant dans les paramètres, ou plus tard avant de lancer
                une mission.
              </p>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="space-y-4" aria-label="Charte d’utilisation">
            <h2 className="t-h2">Charte d’utilisation</h2>
            <div className="t-small space-y-2 rounded-lg bg-primary-softer p-4">
              <p>
                <strong>Vous restez l’auteur responsable de votre travail.</strong>
              </p>
              <ul className="list-disc space-y-1 pl-5 text-text-muted">
                <li>Relisez entièrement le document produit et appropriez-vous son contenu.</li>
                <li>
                  Vérifiez les sources clés : l’outil contrôle leur existence, pas leur pertinence
                  pour votre sujet.
                </li>
                <li>
                  Respectez les règles de votre établissement sur l’usage de l’IA ; certaines
                  exigent une déclaration (un modèle est fourni dans le rapport de mission).
                </li>
                <li>Les données d’enquête viennent de vous : l’outil n’en invente jamais.</li>
              </ul>
            </div>
            <Checkbox
              checked={accepted}
              onCheckedChange={setAccepted}
              label="J’ai lu la charte et je l’accepte"
            />
          </section>
        )}

        <div className="flex items-center justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Retour
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)}>Continuer</Button>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={!accepted || busy}
                onClick={() => void finish(true)}
              >
                Terminer et ouvrir les paramètres
              </Button>
              <Button disabled={!accepted || busy} onClick={() => void finish(false)}>
                Commencer
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
