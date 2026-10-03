import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PlanTree } from '@/components/plan/PlanTree';
import { EstimateCard } from '@/components/plan/EstimateCard';
import { Markdown } from '@/components/Markdown';
import type { AnalysisTableView, CostEstimate, OutlineNodeView } from '@emilio/shared';
import { Home } from 'lucide-react';
import {
  Button,
  ProgressBar,
  StatusBadge,
  Stepper,
  Switch,
  Modal,
  FileRow,
  Sidebar,
  Dropzone,
  EmptyState,
} from '@/components/ui';

describe('composants', () => {
  it('Button : variantes, désactivé et chargement (aria-busy)', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Valider</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button loading onClick={onClick}>
        Valider
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Valider' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });

  it('ProgressBar borne la valeur entre 0 et 100 %', () => {
    const { rerender } = render(<ProgressBar value={150} label="p" />);
    expect((screen.getByRole('progressbar').firstChild as HTMLElement).style.width).toBe('100%');
    rerender(<ProgressBar value={-5} label="p" />);
    expect((screen.getByRole('progressbar').firstChild as HTMLElement).style.width).toBe('0%');
  });

  it('StatusBadge affiche son libellé', () => {
    render(<StatusBadge tone="success">Validée</StatusBadge>);
    expect(screen.getByText('Validée')).toBeInTheDocument();
  });

  it('Stepper : étape courante signalée, étapes faites cochées', () => {
    render(<Stepper steps={['A', 'B', 'C']} current={1} />);
    expect(screen.getByText('B').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('C').closest('li')).not.toHaveAttribute('aria-current');
  });

  it('Switch : rôle switch et bascule', () => {
    const on = vi.fn();
    render(<Switch checked={false} onCheckedChange={on} label="Option" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Option' }));
    expect(on).toHaveBeenCalledWith(true);
  });

  it('Modal : boutons Annuler / Valider en français', () => {
    const onConfirm = vi.fn();
    render(<Modal open onOpenChange={() => {}} title="Titre" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    expect(onConfirm).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('FileRow : bouton de retrait accessible', () => {
    const onRemove = vi.fn();
    render(<FileRow name="a.pdf" meta="PDF" progress={40} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer a.pdf' }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('Dropzone : état survol au dépôt', () => {
    const { container } = render(<Dropzone title="Déposez" />);
    const zone = container.firstChild as HTMLElement;
    fireEvent.dragOver(zone);
    expect(zone.className).toContain('border-primary');
  });

  it('Sidebar : réduite = libellés masqués mais accessibles par titre ; pas de « Pro / Upgrade »', () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <Sidebar nav={[{ to: '/', label: 'Accueil', icon: Home, end: true }]} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Accueil')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <Sidebar collapsed nav={[{ to: '/', label: 'Accueil', icon: Home, end: true }]} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Accueil')).toBeNull();
    expect(screen.getByTitle('Accueil')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/upgrade|pro\b/i);
  });

  it('EmptyState affiche titre et texte', () => {
    render(<EmptyState title="Vide" text="Rien ici" />);
    expect(screen.getByRole('heading', { name: 'Vide' })).toBeInTheDocument();
  });

  const node = (o: Partial<OutlineNodeView> & { id: string }): OutlineNodeView => ({
    parentId: null,
    ordinal: 0,
    level: 'chapitre',
    kind: 'corps',
    numbering: null,
    title: o.id,
    objective: '',
    keyQuestions: [],
    targetWords: 1000,
    requiredSourcesMin: 3,
    sourceIds: [],
    remarks: null,
    templateKey: null,
    ...o,
  });
  const nodes = [
    node({ id: 'a', title: 'Chapitre A', numbering: '1', ordinal: 0 }),
    node({
      id: 'a1',
      title: 'Section A1',
      numbering: '1.1',
      parentId: 'a',
      level: 'section',
      ordinal: 1,
    }),
    node({
      id: 'a2',
      title: 'Section A2',
      numbering: '1.2',
      parentId: 'a',
      level: 'section',
      ordinal: 2,
    }),
    node({ id: 'b', title: 'Chapitre B', numbering: '2', ordinal: 3 }),
  ];
  /** jsdom ne propage pas `clientY` aux événements de glisser-déposer : on le fixe à la main. */
  const dropAt = (li: HTMLElement, y: number, dataTransfer: unknown) => {
    const ev = createEvent.drop(li, { dataTransfer });
    Object.defineProperty(ev, 'clientY', { value: y });
    fireEvent(li, ev);
  };
  const dropOn = (name: string, ratio: number) => {
    const li = screen.getByRole('button', { name }).closest('li')!;
    li.getBoundingClientRect = () => ({
      top: 0,
      height: 100,
      bottom: 100,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    return { li, y: ratio * 100 };
  };

  it('PlanTree : glisser sur le centre d’une carte = à l’intérieur (à la fin), haut = avant, bas = après', () => {
    const onMove = vi.fn();
    render(
      <PlanTree nodes={nodes} selectedId={null} onSelect={() => {}} editable onMove={onMove} />,
    );
    const start = screen.getByRole('button', { name: '1.1 Section A1' }).closest('li')!;
    const data = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(start, { dataTransfer: data });
    const t1 = dropOn('2 Chapitre B', 0.5);
    dropAt(t1.li, t1.y, data);
    expect(onMove).toHaveBeenLastCalledWith('a1', 'b', 0);
    fireEvent.dragStart(start, { dataTransfer: data });
    const t2 = dropOn('1.2 Section A2', 0.05);
    dropAt(t2.li, t2.y, data);
    expect(onMove).toHaveBeenLastCalledWith('a1', 'a', 0); // avant A2, A1 retiré de la liste des frères
    fireEvent.dragStart(start, { dataTransfer: data });
    const t3 = dropOn('2 Chapitre B', 0.95);
    dropAt(t3.li, t3.y, data);
    expect(onMove).toHaveBeenLastCalledWith('a1', null, 2); // après B (frères : A, B)
  });

  it('PlanTree : non éditable = rien n’est glissable ; la somme des mots d’un chapitre est affichée', () => {
    render(
      <PlanTree
        nodes={nodes}
        selectedId="a"
        onSelect={() => {}}
        editable={false}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '1 Chapitre A' }).closest('li')).toHaveAttribute(
      'draggable',
      'false',
    );
    expect(screen.getByText(/2\s?000 mots/)).toBeInTheDocument();
  });

  it('EstimateCard : trois scénarios, mention des prix d’exemple et de l’estimation partielle', () => {
    const e: CostEstimate = {
      scenarios: {
        bas: { costUsd: 1.5, durationSec: 3600 },
        moyen: { costUsd: 2.5, durationSec: 5400 },
        haut: { costUsd: 4, durationSec: 9000 },
      },
      phases: [
        {
          phase: 'P3',
          labelFr: 'Recherche',
          tokensIn: 1,
          tokensOut: 1,
          costUsd: { bas: 1, moyen: 1, haut: 1 },
          durationSec: { bas: 60, moyen: 60, haut: 60 },
        },
      ],
      spentUsd: 0.1,
      budgetMaxUsd: 3,
      exceedsBudget: { bas: false, moyen: false, haut: true },
      partial: true,
      missingPrice: ['x/y'],
      simulated: true,
      sectionCount: 10,
      targetWords: 20000,
      assumptions: [],
      computedAt: '2026-10-03T00:00:00.000Z',
    };
    render(<EstimateCard estimate={e} />);
    expect(screen.getByTestId('scenario-bas')).toHaveTextContent('1 h');
    expect(screen.getByTestId('scenario-moyen')).toHaveTextContent('1 h 30');
    expect(screen.getByTestId('scenario-haut').querySelector('.text-danger')).not.toBeNull();
    expect(screen.getByText('Prix d’exemple (mode simulé)')).toBeInTheDocument();
    expect(screen.getByText(/Minimum : prix inconnu/)).toBeInTheDocument();
  });

  it('Markdown : citations lisibles, emplacements surlignés, titres, tableau de résultats inséré par son jeton', () => {
    const id = '01a102bd-7fb9-7392-8430-40e76f27a1ba';
    const table: AnalysisTableView = {
      id: 'A1',
      tableNumber: 1,
      caption: 'Tableau 1 : Répartition selon « Sexe »',
      source: 'Source : enquête de terrain, mars 2026',
      headers: ['Sexe', 'Effectif'],
      rows: [['Femme', '31']],
      facts: [],
      warnings: [],
      hypothese: null,
      figure: null,
    };
    render(
      <Markdown
        text={`#### Un titre\n\nLe crédit progresse [@${id}, p. 12]. [DONNÉES À INSÉRER : verbatims]\n\n{{TABLEAU:A1}}\n\n{{TABLEAU:A9}}`}
        sources={{ [id]: 'Adjovi et al. (2021)' }}
        tables={[table]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Un titre' })).toBeInTheDocument();
    expect(screen.getByText('Adjovi et al., 2021, p. 12')).toBeInTheDocument();
    expect(screen.getByText('[DONNÉES À INSÉRER : verbatims]').tagName).toBe('MARK');
    expect(screen.getByText('Tableau 1 : Répartition selon « Sexe »')).toBeInTheDocument();
    expect(screen.getByText('Source : enquête de terrain, mars 2026')).toBeInTheDocument();
    // jeton inconnu : ignoré, jamais affiché tel quel
    expect(screen.queryByText(/TABLEAU:A9/)).toBeNull();
  });
});
