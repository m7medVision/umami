import { DataColumn, DataTable, type DataTableProps } from '@umami/react-zen';
import { DateDistance } from '@/components/common/DateDistance';
import Link from '@/components/common/Link';
import { useMessages } from '@/components/hooks';

type ExperimentRow = {
  id: string;
  name: string;
  featureFlag: { key: string; name: string };
  createdAt: string | Date | null;
  runs: {
    id: string;
    runNumber: number;
    status: string;
    readinessStatus: string;
    startedAt: string | Date | null;
    finalizedAt: string | Date | null;
  }[];
};

export function ExperimentsTable({ websiteId, ...props }: DataTableProps & { websiteId: string }) {
  const { t, labels } = useMessages();

  return (
    <DataTable {...props}>
      <DataColumn id="name" label={t(labels.name)}>
        {(experiment: ExperimentRow) => (
          <Link href={`/websites/${websiteId}/experiments/${experiment.id}`}>
            {experiment.name}
          </Link>
        )}
      </DataColumn>
      <DataColumn id="flag" label={t(labels.featureFlag)}>
        {(experiment: ExperimentRow) => (
          <code title={experiment.featureFlag.name}>{experiment.featureFlag.key}</code>
        )}
      </DataColumn>
      <DataColumn id="status" label={t(labels.status)}>
        {(experiment: ExperimentRow) => experiment.runs[0]?.status ?? t(labels.noRuns)}
      </DataColumn>
      <DataColumn id="latestRun" label={t(labels.latestRun)}>
        {(experiment: ExperimentRow) => {
          const run = experiment.runs[0];
          return run ? (
            <Link
              href={
                run.status === 'Draft'
                  ? `/websites/${websiteId}/experiments/${experiment.id}`
                  : `/websites/${websiteId}/experiments/${experiment.id}/runs/${run.id}`
              }
            >
              {t(labels.run)} {run.runNumber} · {run.readinessStatus}
            </Link>
          ) : (
            '—'
          );
        }}
      </DataColumn>
      <DataColumn id="created" label={t(labels.created)}>
        {(experiment: ExperimentRow) =>
          experiment.createdAt ? <DateDistance date={new Date(experiment.createdAt)} /> : '—'
        }
      </DataColumn>
    </DataTable>
  );
}
