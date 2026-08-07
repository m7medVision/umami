import { OPERATORS } from '@/lib/constants';

const SUPPORTED_OPERATORS = new Set<string>(Object.values(OPERATORS));
const STRING_OPERATORS = new Set<string>([
  OPERATORS.equals,
  OPERATORS.notEquals,
  OPERATORS.contains,
  OPERATORS.doesNotContain,
  OPERATORS.regex,
  OPERATORS.notRegex,
]);
const NUMERIC_OPERATORS = new Set<string>([
  OPERATORS.greaterThan,
  OPERATORS.lessThan,
  OPERATORS.greaterThanEquals,
  OPERATORS.lessThanEquals,
]);
const DATE_OPERATORS = new Set<string>([OPERATORS.before, OPERATORS.after]);
const MAX_REGEX_LENGTH = 500;
const MAX_REGEX_INPUT_LENGTH = 10_000;

export interface RealtimeSegmentFilter {
  name: string;
  operator: string;
  value: string;
}

export interface RealtimeSegmentSnapshot {
  type: string;
  parameters: unknown;
}

export type RealtimeSegmentEvaluation =
  | { supported: true; matches: boolean }
  | { supported: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function compileRegex(pattern: string) {
  if (pattern.length > MAX_REGEX_LENGTH) return null;
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

function parseSnapshot(
  snapshot: unknown,
):
  | { supported: true; filters: RealtimeSegmentFilter[]; match: 'all' | 'any' }
  | { supported: false; reason: string } {
  if (!isRecord(snapshot) || snapshot.type !== 'segment' || !isRecord(snapshot.parameters)) {
    return { supported: false, reason: 'Only saved Segment snapshots are supported' };
  }

  const parameters = snapshot.parameters;
  if (Object.keys(parameters).some(key => !['filters', 'match'].includes(key))) {
    return {
      supported: false,
      reason: 'Cohort, history, action, and date-range predicates are not supported',
    };
  }

  const match = parameters.match ?? 'all';
  if (match !== 'all' && match !== 'any') {
    return { supported: false, reason: 'Segment match must be all or any' };
  }
  if (!Array.isArray(parameters.filters) || parameters.filters.length === 0) {
    return { supported: false, reason: 'Segment must contain at least one real-time filter' };
  }

  const filters: RealtimeSegmentFilter[] = [];
  for (const value of parameters.filters) {
    if (!isRecord(value)) {
      return { supported: false, reason: 'Segment contains an invalid filter' };
    }
    if (Object.keys(value).some(key => !['name', 'operator', 'value'].includes(key))) {
      return { supported: false, reason: 'Segment contains an unsupported filter predicate' };
    }
    if (
      typeof value.name !== 'string' ||
      !value.name ||
      typeof value.operator !== 'string' ||
      !SUPPORTED_OPERATORS.has(value.operator) ||
      typeof value.value !== 'string'
    ) {
      return { supported: false, reason: 'Segment contains an invalid filter' };
    }
    if (
      (value.operator === OPERATORS.regex || value.operator === OPERATORS.notRegex) &&
      !compileRegex(value.value)
    ) {
      return { supported: false, reason: 'Segment contains an invalid regular expression' };
    }
    filters.push({ name: value.name, operator: value.operator, value: value.value });
  }

  return { supported: true, filters, match };
}

export function validateRealtimeSegmentSnapshot(snapshot: unknown): RealtimeSegmentEvaluation {
  const parsed = parseSnapshot(snapshot);
  if ('reason' in parsed) {
    return { supported: false, reason: parsed.reason };
  }
  return { supported: true, matches: false };
}

function comparableString(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : null;
}

function compareString(actual: unknown, expected: string, operator: string) {
  if (Array.isArray(actual)) {
    const values = actual.map(comparableString);
    if (values.some(value => value == null)) return null;
    const contains = values.includes(expected);
    if (operator === OPERATORS.equals || operator === OPERATORS.contains) return contains;
    if (operator === OPERATORS.notEquals || operator === OPERATORS.doesNotContain) return !contains;
    return null;
  }

  const value = comparableString(actual);
  if (value == null) return null;
  switch (operator) {
    case OPERATORS.equals:
      return value === expected;
    case OPERATORS.notEquals:
      return value !== expected;
    case OPERATORS.contains:
      return value.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
    case OPERATORS.doesNotContain:
      return !value.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
    case OPERATORS.regex:
    case OPERATORS.notRegex: {
      if (value.length > MAX_REGEX_INPUT_LENGTH) return null;
      const regex = compileRegex(expected);
      if (!regex) return null;
      const matches = regex.test(value);
      return operator === OPERATORS.regex ? matches : !matches;
    }
    default:
      return null;
  }
}

function compareNumber(actual: unknown, expected: string, operator: string) {
  const actualNumber = typeof actual === 'number' ? actual : Number.NaN;
  const expectedNumber = Number(expected);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return null;
  switch (operator) {
    case OPERATORS.greaterThan:
      return actualNumber > expectedNumber;
    case OPERATORS.lessThan:
      return actualNumber < expectedNumber;
    case OPERATORS.greaterThanEquals:
      return actualNumber >= expectedNumber;
    case OPERATORS.lessThanEquals:
      return actualNumber <= expectedNumber;
    default:
      return null;
  }
}

function compareDate(actual: unknown, expected: string, operator: string) {
  if (typeof actual !== 'string') return null;
  const actualTime = Date.parse(actual);
  const expectedTime = Date.parse(expected);
  if (!Number.isFinite(actualTime) || !Number.isFinite(expectedTime)) return null;
  return operator === OPERATORS.before ? actualTime < expectedTime : actualTime > expectedTime;
}

function evaluateFilter(filter: RealtimeSegmentFilter, actual: unknown): boolean | null {
  if (filter.operator === OPERATORS.set) return actual !== undefined && actual !== null;
  if (filter.operator === OPERATORS.notSet) return actual === undefined || actual === null;
  if (filter.operator === OPERATORS.true) return typeof actual === 'boolean' ? actual : null;
  if (filter.operator === OPERATORS.false) return typeof actual === 'boolean' ? !actual : null;
  if (STRING_OPERATORS.has(filter.operator)) {
    return compareString(actual, filter.value, filter.operator);
  }
  if (NUMERIC_OPERATORS.has(filter.operator)) {
    return compareNumber(actual, filter.value, filter.operator);
  }
  if (DATE_OPERATORS.has(filter.operator)) {
    return compareDate(actual, filter.value, filter.operator);
  }
  return null;
}

/** Evaluates a frozen, simple saved-Segment snapshot without I/O or historical lookups. */
export function evaluateRealtimeSegmentSnapshot(
  snapshot: unknown,
  context: Record<string, unknown> | undefined,
): RealtimeSegmentEvaluation {
  const parsed = parseSnapshot(snapshot);
  if ('reason' in parsed) return { supported: false, reason: parsed.reason };
  if (!context || !isRecord(context)) {
    return { supported: false, reason: 'Segment evaluation context is missing' };
  }

  const results: boolean[] = [];
  for (const filter of parsed.filters) {
    const hasField = Object.hasOwn(context, filter.name);
    if (!hasField && filter.operator !== OPERATORS.set && filter.operator !== OPERATORS.notSet) {
      return {
        supported: false,
        reason: `Segment evaluation context is missing ${filter.name}`,
      };
    }
    const result = evaluateFilter(filter, hasField ? context[filter.name] : undefined);
    if (result == null) {
      return {
        supported: false,
        reason: `Segment evaluation context cannot evaluate ${filter.name}`,
      };
    }
    results.push(result);
  }

  return {
    supported: true,
    matches: parsed.match === 'any' ? results.some(Boolean) : results.every(Boolean),
  };
}
