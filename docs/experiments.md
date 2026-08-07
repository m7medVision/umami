# Experiments operational contract

Experiments measure future behavior after a resolved Feature Flag Variation is actually exposed. Feature Flags and Experiments are **not security controls**: applications must enforce authorization independently.

## Architecture and frozen contract

PostgreSQL owns Experiment configuration, Run lifecycle, frozen Outcome/flag/Segment configuration, readiness, promotion history, notifications, retention deadlines, and immutable finalized result snapshots. ClickHouse owns assignment, Exposure, per-Unit Outcome, diagnostic, and privacy-tombstone facts. Redis is only a cache/rate-limit accelerator.

A Run freezes `fnv1a32-v1` bucketing and `bayesian-v1` statistics. Conversion uses Beta-Binomial with fixed `Beta(1,1)` priors, count uses Gamma-Poisson with fixed shape/rate `1,1`, and value/revenue/duration use the Bayesian bootstrap. A finalized Run is always recomputed using its stored version; changing current defaults does not reinterpret history. Baseline and Feature Flag Fallthrough are independent Variations and may be the same.

Only future, resolved Exposures after a Run enters `Running` count. There is no historical Exposure backfill and no retrospective Experiment mode. Historical analytics may be used only for planning.

## Required secrets and identity rotation

Production Experiment collection requires:

- `APP_SECRET`: the HMAC key for pseudonymous identified-visitor digests and signed assignment references. Raw `userKey` is never stored. Do not use the database URL fallback for Experiment identity.
- `EXPERIMENT_JOBS_SECRET`: a separate high-entropy secret accepted only by the internal jobs endpoint. The endpoint fails closed when this variable is absent.

Digests include an identity key version and identity era (`k1.i1` in v1). Rotating `APP_SECRET` changes visitor digests: existing identified assignment continuity and deletion lookup do not cross the rotation automatically. Plan a key-era migration before rotation when continuity or deletion of old-era facts is required. Anonymous session assignment is unaffected. Never log either secret or a raw `userKey`.

## Scheduler deployment

Run the scheduler every five minutes. PostgreSQL `pg_try_advisory_xact_lock` prevents overlapping invocations across replicas. A duplicate invocation exits without work. Running/Paused Runs stale for five minutes are refreshed, Completed Runs are fully recomputed and finalized after their 24-hour provisional deadline, notifications are upserted by dedupe key, and expired raw Run facts are purged.

CLI (recommended for cron, Kubernetes CronJob, or a systemd timer):

```sh
*/5 * * * * cd /app && pnpm experiments:jobs
pnpm experiments:jobs -- --dry-run
```

A Kubernetes CronJob should use `schedule: "*/5 * * * *"`, `concurrencyPolicy: Forbid`, the normal application image, and command `pnpm experiments:jobs`. The database lease remains the authoritative duplicate guard even if orchestration overlap protection fails. A systemd timer should use `OnCalendar=*:0/5` and a oneshot service whose `ExecStart` runs the same command.

Alternatively call the internal endpoint:

```sh
curl --fail -X POST \
  -H "Authorization: Bearer $EXPERIMENT_JOBS_SECRET" \
  https://umami.example/api/jobs/experiments
```

`X-Experiment-Jobs-Secret` is also accepted. Do not expose the secret in a URL. Scheduler failures are isolated per Run and returned in `errors`; the CLI exits non-zero when work failed. A missing ClickHouse configuration is an explicit no-op for raw cleanup, while a configured but unavailable ClickHouse is reported and the Run is not falsely marked expired.

The target is a five-minute computation cadence and **no more than ten minutes visible staleness**, allowing ingestion delay. Dashboards show `Last computed at`; operators should alert if an active Run exceeds ten minutes and inspect scheduler output and ClickHouse health. Authenticated manual refresh is rate-limited (Redis with an in-process fallback).

## Retention, reset, and privacy deletion

At start, each Run persists `rawDataRetainedUntil`, calculated from `EXPERIMENT_RAW_RETENTION_DAYS` (positive integer, default `90`). Set this to the Website analytics-retention period used by the deployment. At the deadline the job removes raw assignment, Exposure, per-Unit Outcome, and diagnostic facts, then persists `rawDataExpiredAt`. Frozen aggregate snapshots remain readable with an expiry warning until Website deletion.

Website analytics reset removes all raw Experiment facts and marks PostgreSQL Runs as raw-data expired, but retains Experiment configuration, promotions, notifications, and frozen result snapshots. Privacy tombstones remain so a reset cannot resurrect a deleted identity.

Authenticated visitor privacy deletion accepts a raw `userKey` only at the request boundary, derives its HMAC server-side, writes a tombstone, removes matching identified facts, and audits only the operation. Aggregate CSV and frozen-configuration JSON exports never include visitor digests or raw Exposure rows.

Website deletion removes all Experiment PostgreSQL children manually (the schema uses `relationMode = "prisma"`) and all ClickHouse Experiment facts, including tombstones. If configured ClickHouse cleanup fails, reset/deletion fails before PostgreSQL mutation rather than reporting a partial deletion as success.

## Failure behavior

- Ordinary Feature Flag evaluation remains available if Experiment assignment, ClickHouse collection, APP_SECRET-based Experiment identity, or Redis fails. The ordinary deterministic flag value is returned without resolved Experiment metadata.
- Exposure delivery is best-effort, uses keepalive/retry behavior in the tracker, and never blocks rendering or flag application. Collection failures affect diagnostics, not evaluation.
- Redis cache reads fall back to PostgreSQL and refresh rate limiting falls back to process-local state.
- Computation failures leave the previous result and `Last computed at` visible; they do not auto-stop, auto-complete, or mutate a flag.
- A configured ClickHouse failure during destructive reset/deletion is surfaced. Operators can correct the outage and retry safely.
- Completing never changes a Feature Flag. Promotion and rollback are explicit, conflict-checked actions and never rewrite Experiment results.

## SDK Exposure usage

Automatic Exposure is enabled for resolved calls to:

```js
await umami.flags({ plan: 'pro' }); // Optional in-memory context for saved-Segment filters.
const value = umami.getFeatureValue('checkout-layout', 'safe-fallback');
const enabled = umami.isFeatureEnabled('new-checkout');
```

Call `await umami.flags(context)` before rendering Experiment-dependent UI. Context is used in memory for supported frozen saved-Segment filters and is not persisted on Exposure records. A synchronous unresolved fallback is not an Exposure. Set `data-auto-flag-exposure="false"` to disable automatic collection and use `umami.exposeFeatureFlag(key)` only after a server-resolved assignment. Explicit unknown/unresolved assignment is rejected. Evaluation never waits for Exposure delivery.

## Lifecycle, limits, and permissions

Lifecycle is `Draft -> Running <-> Paused -> Completed -> Finalized -> Archived`. Pausing stops new assignment/Exposure while already exposed Units can produce Outcomes through their attribution window. Completion opens a 24-hour provisional window; finalization performs a full recomputation and freezes the snapshot. Runs with Exposure history are archived, never deleted.

Hard v1 limits are enforced by request schemas, services, and active-Run database indexes:

- 2–10 Variations per Run;
- exactly one Primary Outcome and at most ten Secondary Outcomes;
- at most 20 Running/Paused Runs per Website;
- at most one Running/Paused Run per Feature Flag (and per Experiment definition);
- visitor attribution windows of 1–30 days;
- only post-Exposure Outcomes and only Exposures collected while `Running`.

Website viewers can view Runs/results and aggregate exports. Website editors/managers can create and control Runs, refresh, promote, and roll back. Existing Website delete permission is required to archive Runs/Experiments and perform privacy deletion. Standard exports are aggregate CSV and frozen Run/statistics JSON only.

## Deferred from v1

Frequentist models, advanced sequential testing, automatic stopping, automatic promotion, currency conversion, email/webhook notifications, raw visitor/Exposure export, retrospective Experiments, cross-project Experiments, and retrospective Exposure backfill are intentionally unsupported.
