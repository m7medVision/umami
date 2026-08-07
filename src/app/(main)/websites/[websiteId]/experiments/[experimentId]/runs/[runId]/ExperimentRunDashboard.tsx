'use client';

import { Column, Row } from '@umami/react-zen';
import { useState } from 'react';
import { Panel } from '@/components/common/Panel';
import { useApi, useExperimentRunResultsQuery } from '@/components/hooks';

interface Props {
  websiteId: string;
  experimentId: string;
  runId: string;
}

function percent(value: number) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

function CumulativeSeries({ rows }: { rows: any[] }) {
  if (!rows?.length) return <p>No cumulative data yet.</p>;
  const values = rows.map(row => Number(row.value || row.converted || row.eventCount || 0));
  const max = Math.max(1, ...values);
  const points = values
    .map(
      (value, index) =>
        `${(index / Math.max(1, values.length - 1)) * 100},${40 - (value / max) * 36}`,
    )
    .join(' ');
  return (
    <figure aria-label="Cumulative result series">
      <svg viewBox="0 0 100 44" role="img" style={{ width: '100%', maxHeight: 180 }}>
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <figcaption>Cumulative through {rows.at(-1)?.date}</figcaption>
    </figure>
  );
}

export function ExperimentRunDashboard({ websiteId, experimentId, runId }: Props) {
  const query = useExperimentRunResultsQuery(websiteId, experimentId, runId);
  const { post } = useApi();
  const [mode, setMode] = useState<'session' | 'visitor'>('session');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (query.isLoading) return <p>Loading Experiment results…</p>;
  if (query.error || !query.data)
    return <p role="alert">Experiment results could not be loaded.</p>;

  const data: any = query.data;
  const results = data.results;
  const selected = results?.modes?.[mode];
  const primary = selected?.outcomes?.find((outcome: any) => outcome.role === 'primary');
  const remaining = selected?.outcomes?.filter((outcome: any) => outcome.role !== 'primary') ?? [];
  const canEdit = data.permissions?.canEdit === true;
  const canArchive = data.permissions?.canArchive === true;
  const readiness = selected?.readiness;
  const run = data.run;

  async function action(name: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setActionError(null);
    try {
      const path =
        name === 'refresh'
          ? `/websites/${websiteId}/experiments/${experimentId}/runs/${runId}/refresh`
          : `/websites/${websiteId}/experiments/${experimentId}/runs/${runId}/actions/${name}`;
      await post(path, body);
      await query.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  const actions =
    run.status === 'Running'
      ? ['pause', 'complete']
      : run.status === 'Paused'
        ? ['resume', 'complete']
        : run.status === 'Completed'
          ? ['finalize']
          : [];
  const isProvisional =
    run.status === 'Completed' &&
    run.provisionalUntil &&
    new Date(run.provisionalUntil).getTime() > Date.now();

  return (
    <Column gap="4">
      <Panel>
        <Column gap="3">
          <Row justifyContent="space-between" alignItems="center">
            <div>
              <h1>Experiment Run {run.runNumber}</h1>
              <p>
                <strong>{run.status}</strong> · {readiness?.ready ? 'Ready to decide' : 'Not ready'}
              </p>
            </div>
            <div role="group" aria-label="Attribution mode">
              <button
                type="button"
                aria-pressed={mode === 'session'}
                onClick={() => setMode('session')}
              >
                Session
              </button>
              <button
                type="button"
                aria-pressed={mode === 'visitor'}
                onClick={() => setMode('visitor')}
              >
                Visitor
              </button>
            </div>
          </Row>
          <p>Last computed at: {new Date(data.computedAt).toLocaleString()}</p>
          <p>Source data through: {new Date(data.sourceDataThroughAt).toLocaleString()}</p>
          {run.status === 'Completed' && (
            <p role="status">
              Results are provisional until{' '}
              {run.provisionalUntil
                ? new Date(run.provisionalUntil).toLocaleString()
                : 'finalization'}
              . Promotion during this window is explicit and may be rolled back.
            </p>
          )}
          {canEdit && (
            <Row gap="2" wrap="wrap">
              {!data.immutable && (
                <button disabled={busy} type="button" onClick={() => action('refresh')}>
                  Refresh results
                </button>
              )}
              {actions.map(name => (
                <button
                  disabled={busy || (name === 'finalize' && isProvisional)}
                  key={name}
                  type="button"
                  onClick={() => action(name)}
                >
                  {name[0].toUpperCase() + name.slice(1)}
                </button>
              ))}
              {['Completed', 'Finalized'].includes(run.status) &&
                readiness?.winnerVariation != null &&
                !run.promotion?.promotedAt && (
                  <button
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      action('promote', { winningVariation: readiness.winnerVariation })
                    }
                  >
                    {run.status === 'Completed' ? 'Promote provisional winner' : 'Promote winner'}
                  </button>
                )}
              {run.promotion?.promotedAt && !run.promotion?.rolledBackAt && (
                <button disabled={busy} type="button" onClick={() => action('rollback')}>
                  Rollback promotion
                </button>
              )}
              {canArchive && run.status === 'Finalized' && (
                <button disabled={busy} type="button" onClick={() => action('archive')}>
                  Archive
                </button>
              )}
            </Row>
          )}
          {actionError && <p role="alert">{actionError}</p>}
        </Column>
      </Panel>

      {(results?.warnings?.length > 0 || results?.rawRetention?.expired) && (
        <Panel>
          <h2>Data-quality warnings</h2>
          <ul>
            {results.warnings.map((warning: string) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel>
        <h2>Exposed Units by Variation</h2>
        <table>
          <thead>
            <tr>
              <th>Variation</th>
              <th>Units</th>
              <th>Observed rate</th>
              <th>Frozen weight</th>
            </tr>
          </thead>
          <tbody>
            {selected?.exposures?.map((row: any) => (
              <tr key={row.variation}>
                <td>
                  {results.variations[row.variation]?.name ?? `Variation ${row.variation + 1}`}
                </td>
                <td>{row.exposed}</td>
                <td>{percent(row.rate)}</td>
                <td>{percent(row.expectedRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel>
        <h2>Primary Bayesian result</h2>
        {!primary ? (
          <p>Primary Outcome is unavailable in {mode} mode.</p>
        ) : (
          <>
            <h3>{primary.name}</h3>
            <table>
              <thead>
                <tr>
                  <th>Variation</th>
                  <th>Rate</th>
                  <th>Probability to win</th>
                  <th>Uplift interval</th>
                  <th>Expected loss</th>
                </tr>
              </thead>
              <tbody>
                {primary.statistics.variations.map((variation: any) => {
                  const total = primary.totals.find(
                    (item: any) => item.variation === variation.variation,
                  );
                  return (
                    <tr key={variation.variation}>
                      <td>
                        {results.variations[variation.variation]?.name ?? variation.variation}
                      </td>
                      <td>{percent(total?.rate)}</td>
                      <td>{percent(variation.probabilityToWin)}</td>
                      <td>{variation.uplift.credibleInterval.map(percent).join(' – ')}</td>
                      <td>{variation.expectedLoss.toFixed(4)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <CumulativeSeries rows={primary.cumulative} />
          </>
        )}
      </Panel>

      <Panel>
        <h2>Safeguards</h2>
        <ul>
          {Object.entries(readiness?.checks ?? {}).map(([name, check]: [string, any]) => (
            <li key={name}>
              {check.passed ? 'Pass' : 'Needs attention'}: {name}
            </li>
          ))}
        </ul>
        <p>Only the Primary Outcome affects official readiness.</p>
      </Panel>

      <Panel>
        <h2>Secondary and standard metrics</h2>
        {remaining.length === 0 ? (
          <p>No additional metrics for this mode.</p>
        ) : (
          remaining.map((outcome: any) => (
            <section key={outcome.id}>
              <h3>{outcome.name}</h3>
              <p>
                {outcome.type} · {outcome.countingMode}
              </p>
            </section>
          ))
        )}
      </Panel>

      <Panel>
        <h2>Diagnostics</h2>
        <dl>
          {Object.entries(results?.diagnostics ?? {})
            .filter(([, value]) => typeof value === 'number')
            .map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
        </dl>
      </Panel>

      <Panel>
        <h2>Exploratory filters</h2>
        <p>Post-hoc filters are labeled Exploratory and never alter official readiness.</p>
      </Panel>
    </Column>
  );
}
