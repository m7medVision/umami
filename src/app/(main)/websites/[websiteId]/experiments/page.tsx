import type { Metadata } from 'next';
import { ExperimentsPage } from './ExperimentsPage';

export default async function Page({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  return <ExperimentsPage websiteId={websiteId} />;
}

export const metadata: Metadata = { title: 'Experiments' };
