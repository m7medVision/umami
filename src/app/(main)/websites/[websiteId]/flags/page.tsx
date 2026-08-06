import type { Metadata } from 'next';
import { FlagsPage } from './FlagsPage';

export default async function ({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  return <FlagsPage websiteId={websiteId} />;
}

export const metadata: Metadata = {
  title: 'Feature flags',
};
