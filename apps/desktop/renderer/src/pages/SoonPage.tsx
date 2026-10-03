import { Hammer } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui';
import { fr } from '@/lib/fr';

export function SoonPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} breadcrumb={[title]} />
      <EmptyState icon={Hammer} title={fr.common.soon} text={fr.common.soonText} />
    </>
  );
}
