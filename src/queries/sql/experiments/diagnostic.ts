import clickhouse from '@/lib/clickhouse';
import { uuid } from '@/lib/crypto';
import { clickhouseDateTime64, ZERO_UUID } from './utils';

export const EXPERIMENT_DIAGNOSTIC_TYPES = [
  'duplicate',
  'crossover',
  'missing-identity',
  'late-event',
  'exclusion',
  'collection-failure',
  'privacy-deletion',
  'excluded-currency',
] as const;

export type ExperimentDiagnosticType = (typeof EXPERIMENT_DIAGNOSTIC_TYPES)[number];

export interface SaveExperimentDiagnosticArgs {
  websiteId: string;
  experimentRunId?: string | null;
  type: ExperimentDiagnosticType;
  reason?: string;
  count?: number;
  occurredAt?: Date;
}

export async function saveExperimentDiagnostic({
  websiteId,
  experimentRunId,
  type,
  reason = '',
  count = 1,
  occurredAt = new Date(),
}: SaveExperimentDiagnosticArgs) {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error('Diagnostic count must be a positive integer.');
  }

  await clickhouse.insert('experiment_diagnostic', [
    {
      diagnostic_id: uuid(),
      website_id: websiteId,
      experiment_run_id: experimentRunId ?? ZERO_UUID,
      diagnostic_type: type,
      reason,
      count,
      occurred_at: clickhouseDateTime64(occurredAt),
    },
  ]);
}
