import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
});
