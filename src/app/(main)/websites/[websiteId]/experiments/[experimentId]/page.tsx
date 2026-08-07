import type { Metadata } from 'next';
import { ExperimentPage } from './ExperimentPage';

export default async function Page({
  params,
}: {
  params: Promise<{ websiteId: string; experimentId: string }>;
}) {
  const { websiteId, experimentId } = await params;
  return <ExperimentPage websiteId={websiteId} experimentId={experimentId} />;
}

export const metadata: Metadata = { title: 'Experiment' };
