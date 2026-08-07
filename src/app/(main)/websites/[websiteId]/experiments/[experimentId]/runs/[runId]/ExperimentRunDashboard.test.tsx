import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ExperimentRunDashboard } from './ExperimentRunDashboard';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  query: {
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    data: null as any,
  },
}));

vi.mock('@/components/common/Panel', () => ({
  Panel: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/hooks', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/hooks')>()),
  useApi: () => ({ post: mocks.post }),
  useExperimentRunResultsQuery: () => mocks.query,
}));

beforeEach(() => {
  mocks.query.data = {
    immutable: false,
    computedAt: '2026-01-02T00:00:00Z',
    sourceDataThroughAt: '2026-01-02T00:00:00Z',
    permissions: { canEdit: false },
    run: { runNumber: 1, status: 'Running', promotion: null },
    results: {
      variations: [{ name: 'Control' }, { name: 'Treatment' }],
      warnings: [],
      diagnostics: {},
      rawRetention: { expired: false },
      modes: {
        session: {
          exposures: [{ variation: 0, exposed: 10, rate: 1, expectedRate: 0.5 }],
          readiness: { ready: false, checks: {} },
          outcomes: [
            {
              id: 'p',
              name: 'Signup',
              role: 'primary',
              type: 'conversion',
              countingMode: 'unique',
              totals: [],
              cumulative: [],
              statistics: { variations: [] },
            },
          ],
        },
        visitor: { exposures: [], readiness: { ready: false, checks: {} }, outcomes: [] },
      },
    },
  };
});

test('Viewer can switch modes but sees no mutating controls', () => {
  render(<ExperimentRunDashboard websiteId="w" experimentId="e" runId="r" />);
  expect(screen.getByText('Signup')).toBeInTheDocument();
  expect(screen.queryByText('Refresh results')).not.toBeInTheDocument();
  expect(screen.queryByText('Pause')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Visitor' }));
  expect(screen.getByText('Primary Outcome is unavailable in visitor mode.')).toBeInTheDocument();
});

test('Editor sees lifecycle and refresh controls', () => {
  mocks.query.data.permissions.canEdit = true;
  render(<ExperimentRunDashboard websiteId="w" experimentId="e" runId="r" />);
  expect(screen.getByText('Refresh results')).toBeInTheDocument();
  expect(screen.getByText('Pause')).toBeInTheDocument();
  expect(screen.getByText('Complete')).toBeInTheDocument();
});

test('Completed Run warns before provisional promotion and delays finalization', () => {
  mocks.query.data.permissions.canEdit = true;
  mocks.query.data.run = {
    runNumber: 1,
    status: 'Completed',
    provisionalUntil: '2099-01-02T00:00:00Z',
    promotion: null,
  };
  mocks.query.data.results.modes.session.readiness.winnerVariation = 1;

  render(<ExperimentRunDashboard websiteId="w" experimentId="e" runId="r" />);

  expect(screen.getByRole('status')).toHaveTextContent('Results are provisional');
  expect(screen.getByText('Promote provisional winner')).toBeInTheDocument();
  expect(screen.getByText('Finalize')).toBeDisabled();
});

test('Website delete permission exposes archive for a Finalized Run', () => {
  mocks.query.data.permissions = { canEdit: true, canArchive: true };
  mocks.query.data.run.status = 'Finalized';

  render(<ExperimentRunDashboard websiteId="w" experimentId="e" runId="r" />);

  expect(screen.getByText('Archive')).toBeInTheDocument();
});
