'use client';

import { Column } from '@umami/react-zen';
import { WebsiteControls } from '@/app/(main)/websites/[websiteId]/WebsiteControls';
import { Panel } from '@/components/common/Panel';
import { FlagsDataTable } from './FlagsDataTable';

export function FlagsPage({ websiteId }: { websiteId: string }) {
  return (
    <Column gap="3">
      <WebsiteControls websiteId={websiteId} allowFilter={false} allowDateFilter={false} />
      <Panel>
        <FlagsDataTable websiteId={websiteId} />
      </Panel>
    </Column>
  );
}
