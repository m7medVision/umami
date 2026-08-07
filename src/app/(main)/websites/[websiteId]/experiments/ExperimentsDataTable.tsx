'use client';

import { Row } from '@umami/react-zen';
import { useState } from 'react';
import { DataGrid } from '@/components/common/DataGrid';
import { Empty } from '@/components/common/Empty';
import { useMessages, useWebsiteExperimentsQuery } from '@/components/hooks';
import { ExperimentCreateButton } from './ExperimentCreateButton';
import { ExperimentNotificationsButton } from './ExperimentNotificationsButton';
import { ExperimentsTable } from './ExperimentsTable';

const statuses = ['', 'Draft', 'Running', 'Paused', 'Completed', 'Finalized', 'Archived'];

export function ExperimentsDataTable({ websiteId }: { websiteId: string }) {
  const { t, labels, messages } = useMessages();
  const [status, setStatus] = useState('');
  const query = useWebsiteExperimentsQuery(websiteId, status ? { status } : undefined);
  const canEdit = query.data?.permissions?.canEdit === true;

  return (
    <DataGrid
      query={query}
      allowSearch
      autoFocus={false}
      allowPaging
      renderActions={() => (
        <Row gap="2" alignItems="center" wrap="wrap">
          <label>
            <span style={{ marginRight: 8 }}>{t(labels.status)}</span>
            <select
              aria-label={t(labels.experimentStatus)}
              value={status}
              onChange={event => setStatus(event.currentTarget.value)}
            >
              {statuses.map(value => (
                <option key={value || 'all'} value={value}>
                  {value || t(labels.all)}
                </option>
              ))}
            </select>
          </label>
          <ExperimentNotificationsButton websiteId={websiteId} canEdit={canEdit} />
          {canEdit && <ExperimentCreateButton websiteId={websiteId} />}
        </Row>
      )}
      renderEmpty={() => <Empty message={t(messages.noExperiments)} />}
    >
      {({ data }) => <ExperimentsTable websiteId={websiteId} data={data} />}
    </DataGrid>
  );
}
