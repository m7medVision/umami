import clickhouse from '@/lib/clickhouse';

export const EXPERIMENT_ASSIGNMENT_VERSION = 'assignment-v1';
export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
export const SENSITIVE_EXPERIMENT_PARAMS = [
  'unitKey',
  'visitorDigest',
  'sessionAssignmentKey',
] as const;

export function clickhouseDateTime64(date: Date) {
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${clickhouse.getUTCString(date)}.${milliseconds}`;
}
