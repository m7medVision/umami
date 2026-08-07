import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ExperimentSetupForm } from './ExperimentSetupForm';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  touch: vi.fn(),
  toast: vi.fn(),
  options: {
    isLoading: false,
    error: null,
    data: {
      permissions: { canEdit: true },
      featureFlags: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          key: 'checkout',
          name: 'Checkout',
          valueType: 'string',
          variations: [{ value: 'control' }, { value: 'treatment' }],
          rollout: { percentage: 100, weights: [0.5, 0.5] },
          defaultVariation: 0,
        },
      ],
      segments: [],
      mutualExclusionGroups: [],
    },
  } as any,
}));

vi.mock('@umami/react-zen', async importOriginal => ({
  ...(await importOriginal<typeof import('@umami/react-zen')>()),
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/components/hooks', () => ({
  useApi: () => ({ post: mocks.post }),
  useExperimentSetupOptionsQuery: () => mocks.options,
  useMessages: () => ({
    t: (key: string) => key,
    labels: new Proxy({}, { get: (_target, property) => `label.${String(property)}` }),
    messages: new Proxy({}, { get: (_target, property) => `message.${String(property)}` }),
    getErrorMessage: (error: Error) => error?.message,
  }),
  useModified: () => ({ touch: mocks.touch }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.data.permissions.canEdit = true;
  mocks.post.mockResolvedValueOnce({ id: 'experiment-1' }).mockResolvedValueOnce({ id: 'run-1' });
});

test('represents setup warnings and allows Baseline to equal Fallthrough', async () => {
  const { container } = render(<ExperimentSetupForm websiteId="website-1" />);

  expect(screen.getByText('message.experimentFutureOnlyWarning')).toBeInTheDocument();
  expect(screen.getByText('message.experimentAwaitFlagsWarning')).toBeInTheDocument();
  expect(screen.getByText('message.experimentSecurityWarning')).toBeInTheDocument();
  expect(screen.getByText('message.experimentInterferenceWarning')).toBeInTheDocument();

  await waitFor(() => expect(screen.getByDisplayValue('Checkout (checkout)')).toBeInTheDocument());
  fireEvent.change(screen.getAllByLabelText('label.name')[0], {
    target: { value: 'Checkout test' },
  });
  fireEvent.change(screen.getByLabelText('label.eventName'), { target: { value: 'purchase' } });
  const form = container.querySelector('form');
  expect(form).not.toBeNull();
  if (form) fireEvent.submit(form);

  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  const runRequest = mocks.post.mock.calls[1][1];
  expect(runRequest.configuration).toMatchObject({
    baselineVariation: 0,
    featureFlag: {
      fallthroughVariation: 0,
      variations: [{ value: 'control' }, { value: 'treatment' }],
    },
    outcomes: [
      { role: 'primary', type: 'conversion', source: { type: 'event', eventName: 'purchase' } },
    ],
  });
});

test('denies setup to Website viewers', () => {
  mocks.options.data.permissions.canEdit = false;
  render(<ExperimentSetupForm websiteId="website-1" />);
  expect(screen.getByRole('alert')).toHaveTextContent('message.experimentEditorRequired');
});
