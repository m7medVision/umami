'use client';

import { Column } from '@umami/react-zen';
import { WebsiteControls } from '@/app/(main)/websites/[websiteId]/WebsiteControls';
import { Panel } from '@/components/common/Panel';
import { ExperimentsDataTable } from './ExperimentsDataTable';

export function ExperimentsPage({ websiteId }: { websiteId: string }) {
  return (
    <Column gap="3">
      <WebsiteControls websiteId={websiteId} allowFilter={false} allowDateFilter={false} />
      <Panel>
        <ExperimentsDataTable websiteId={websiteId} />
      </Panel>
    </Column>
  );
}
