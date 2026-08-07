import { conflict, notFound, serverError } from '@/lib/response';
import { ExperimentLifecycleError } from './lifecycle';
import { ExperimentServiceError } from './runService';

/** Experiment Runs contain a PostgreSQL BIGINT pause accumulator; expose it as a safe JSON number. */
export function experimentJson(data: unknown) {
  return Response.json(
    JSON.parse(
      JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? Number(value) : value)),
    ),
  );
}

export function experimentErrorResponse(error: unknown) {
  if (error instanceof ExperimentServiceError) {
    if (error.status === 404) return notFound({ message: error.message, code: error.code });
    if (error.status === 409 || error.status === 400 || error.status === 503) {
      return Response.json(
        { error: { message: error.message, code: error.code, status: error.status } },
        { status: error.status },
      );
    }
  }
  if (error instanceof ExperimentLifecycleError) {
    return conflict({ message: error.message, code: error.code });
  }
  return serverError(error);
}
