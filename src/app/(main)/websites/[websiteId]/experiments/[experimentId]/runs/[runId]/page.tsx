import type { Metadata } from 'next';
import { ExperimentRunDashboard } from './ExperimentRunDashboard';

export default async function ExperimentRunPage({
  params,
}: {
  params: Promise<{ websiteId: string; experimentId: string; runId: string }>;
}) {
  const { websiteId, experimentId, runId } = await params;
  return <ExperimentRunDashboard websiteId={websiteId} experimentId={experimentId} runId={runId} />;
}

export const metadata: Metadata = { title: 'Experiment Run' };
