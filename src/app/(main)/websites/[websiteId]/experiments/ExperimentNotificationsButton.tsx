'use client';

import { Button, Column, Row } from '@umami/react-zen';
import { Bell } from 'lucide-react';
import Link from '@/components/common/Link';
import { useApi, useExperimentNotificationsQuery, useMessages } from '@/components/hooks';
import { DialogButton } from '@/components/input/DialogButton';

const notificationLabels: Record<string, string> = {
  'sample-ratio-mismatch': 'Sample-ratio mismatch',
  'sample-reached': 'Minimum sample reached',
  'ready-to-decide': 'Ready to decide',
  finalized: 'Finalization complete',
  promoted: 'Winner promoted',
  'rolled-back': 'Promotion rolled back',
};

export function ExperimentNotificationsButton({
  websiteId,
  canEdit,
}: {
  websiteId: string;
  canEdit: boolean;
}) {
  const { t, labels, messages, getErrorMessage } = useMessages();
  const query = useExperimentNotificationsQuery(websiteId);
  const { put } = useApi();
  const notifications = query.data?.data ?? [];

  async function update(notificationId: string, action: 'read' | 'dismiss') {
    await put(`/websites/${websiteId}/experiments/notifications/${notificationId}`, { action });
    await query.refetch();
  }

  return (
    <DialogButton
      icon={<Bell />}
      label={`${t(labels.notifications)}${query.data?.unreadCount ? ` (${query.data.unreadCount})` : ''}`}
      width="620px"
    >
      <Column gap="3">
        {query.isLoading && <p>{t(messages.loadingExperimentNotifications)}</p>}
        {query.error && <p role="alert">{getErrorMessage(query.error)}</p>}
        {!query.isLoading && notifications.length === 0 && (
          <p>{t(messages.noExperimentNotifications)}</p>
        )}
        {notifications.map((notification: any) => (
          <section
            key={notification.id}
            style={{ borderBottom: '1px solid var(--base300)', paddingBottom: 12 }}
          >
            <Row justifyContent="space-between" alignItems="center" gap="2">
              <div>
                <strong>{notificationLabels[notification.type] ?? notification.type}</strong>
                {!notification.readAt && <span aria-label={t(labels.unread)}> · New</span>}
                <div>
                  {notification.experimentId && notification.experimentRunId ? (
                    <Link
                      href={`/websites/${websiteId}/experiments/${notification.experimentId}/runs/${notification.experimentRunId}`}
                    >
                      {t(labels.viewRun)}
                    </Link>
                  ) : null}
                </div>
              </div>
              {canEdit && (
                <Row gap="1">
                  {!notification.readAt && (
                    <Button onPress={() => update(notification.id, 'read')}>
                      {t(labels.markRead)}
                    </Button>
                  )}
                  <Button onPress={() => update(notification.id, 'dismiss')}>
                    {t(labels.dismiss)}
                  </Button>
                </Row>
              )}
            </Row>
          </section>
        ))}
        {!canEdit && <small>{t(messages.experimentNotificationViewer)}</small>}
      </Column>
    </DialogButton>
  );
}
