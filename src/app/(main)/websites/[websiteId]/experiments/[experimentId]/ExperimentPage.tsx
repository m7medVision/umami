'use client';

import { Button, Column, Row } from '@umami/react-zen';
import Link from '@/components/common/Link';
import { Panel } from '@/components/common/Panel';
import { useApi, useExperimentSetupOptionsQuery, useMessages } from '@/components/hooks';
import { ExperimentArchiveButton } from '../ExperimentArchiveButton';

export function ExperimentPage({
  websiteId,
  experimentId,
}: {
  websiteId: string;
  experimentId: string;
}) {
  const { t, labels, messages, getErrorMessage } = useMessages();
  const { get, post, useQuery } = useApi();
  const options = useExperimentSetupOptionsQuery(websiteId);
  const query = useQuery({
    queryKey: ['experiment', { websiteId, experimentId }],
    queryFn: async () => {
      const [experiment, runs] = await Promise.all([
        get(`/websites/${websiteId}/experiments/${experimentId}`),
        get(`/websites/${websiteId}/experiments/${experimentId}/runs`),
      ]);
      return { experiment, runs: runs.data };
    },
  });
  const canEdit = options.data?.permissions?.canEdit === true;
  const canArchive = options.data?.permissions?.canArchive === true;

  async function start(runId: string) {
    await post(
      `/websites/${websiteId}/experiments/${experimentId}/runs/${runId}/actions/start`,
      {},
    );
    await query.refetch();
  }

  if (query.isLoading) return <p>{t(messages.loadingExperiment)}</p>;
  if (query.error || !query.data) return <p role="alert">{getErrorMessage(query.error)}</p>;

  const { experiment, runs } = query.data;
  return (
    <Column gap="3">
      <Panel>
        <h1>{experiment.name}</h1>
        <p>{experiment.description}</p>
        <p>
          {t(labels.featureFlag)}: <code>{experiment.featureFlag.key}</code>
        </p>
        {canArchive && (
          <ExperimentArchiveButton
            websiteId={websiteId}
            experimentId={experimentId}
            name={experiment.name}
          />
        )}
      </Panel>
      <Panel>
        <h2>{t(labels.runs)}</h2>
        {!runs.length && <p>{t(messages.noExperimentRuns)}</p>}
        <Column gap="3">
          {runs.map((run: any) => (
            <section key={run.id} style={{ borderBottom: '1px solid var(--base300)' }}>
              <Row justifyContent="space-between" alignItems="center" wrap="wrap" gap="2">
                <div>
                  <strong>
                    {t(labels.run)} {run.runNumber}
                  </strong>
                  <p>
                    {run.status} · {run.readinessStatus}
                  </p>
                </div>
                <Row gap="2">
                  {run.status === 'Draft' ? (
                    canEdit && <Button onPress={() => start(run.id)}>{t(labels.start)}</Button>
                  ) : (
                    <Link
                      href={`/websites/${websiteId}/experiments/${experimentId}/runs/${run.id}`}
                    >
                      {t(labels.openRunDashboard)}
                    </Link>
                  )}
                </Row>
              </Row>
            </section>
          ))}
        </Column>
      </Panel>
      <Link href={`/websites/${websiteId}/experiments`}>{t(labels.backToExperiments)}</Link>
    </Column>
  );
}
