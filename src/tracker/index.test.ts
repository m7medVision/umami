import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111';

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

async function loadTracker(attributes: Record<string, string> = {}) {
  vi.resetModules();
  const script = document.createElement('script');
  script.src = 'https://analytics.example/script.js';
  script.setAttribute('data-website-id', WEBSITE_ID);
  script.setAttribute('data-auto-track', 'false');
  for (const [name, value] of Object.entries(attributes)) {
    script.setAttribute(name, value);
  }
  document.head.append(script);
  Object.defineProperty(document, 'currentScript', { configurable: true, value: script });
  (window as any).umami = undefined;
  await import('./index');
  return window.umami;
}

const resolvedFlags = {
  flags: { checkout: { enabled: true, value: 'compact' } },
  experiments: {
    checkout: {
      resolved: true,
      variation: 1,
      assignment: 'opaque-assignment',
      reference: 'opaque-reference',
    },
  },
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.querySelectorAll('script').forEach(script => {
    script.remove();
  });
});

describe('Experiment flags tracker interface', () => {
  test('creates and reuses an anonymous per-tab UUID in eval requests', async () => {
    vi.mocked(fetch).mockImplementation(() => response(resolvedFlags));
    const umami = await loadTracker();

    await umami.flags();
    const firstBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(firstBody.assignmentKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(firstBody.participate).toBe(true);
    expect(firstBody.context).toMatchObject({ website: WEBSITE_ID });

    vi.mocked(fetch).mockClear();
    (window as any).umami = undefined;
    const next = await loadTracker();
    await next.flags();
    const secondBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(secondBody.assignmentKey).toBe(firstBody.assignmentKey);
  });

  test('uses identify identity in later evaluations', async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(() => response({ cache: 'cache-token' }))
      .mockImplementationOnce(() => response(resolvedFlags));
    const umami = await loadTracker();

    await umami.identify('customer-42', { plan: 'pro' });
    await umami.flags();

    const evalBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string);
    expect(evalBody.userKey).toBe('customer-42');
    expect(evalBody.assignmentKey).toBeTruthy();
    expect(evalBody.context.plan).toBe('pro');
  });

  test('ignores an older flag response after evaluation context changes', async () => {
    let resolveFirst: (value: Response) => void;
    let resolveSecond: (value: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise(resolve => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise(resolve => (resolveSecond = resolve)));
    const umami = await loadTracker();

    const first = umami.flags({ country: 'US' });
    const second = umami.flags({ country: 'CA' });
    expect(resolveSecond).toBeTypeOf('function');
    resolveSecond?.(
      new Response(
        JSON.stringify({
          flags: { checkout: { enabled: true, value: 'new-context' } },
          experiments: { checkout: { resolved: false } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await second;
    expect(resolveFirst).toBeTypeOf('function');
    resolveFirst?.(
      new Response(
        JSON.stringify({
          flags: { checkout: { enabled: true, value: 'stale-context' } },
          experiments: { checkout: { resolved: false } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await first;

    expect(umami.getFeatureValue('checkout')).toBe('new-context');
  });

  test('automatically exposes only a resolved assignment and deduplicates duplicate getters', async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(resolvedFlags))
      .mockImplementation(() => response({ cache: 'cache-token' }));
    const umami = await loadTracker();
    await umami.flags();

    expect(umami.getFeatureValue('checkout', 'fallback')).toBe('compact');
    expect(umami.isFeatureEnabled('checkout')).toBe(true);
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));

    const exposure = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string);
    expect(exposure).toMatchObject({
      type: 'flag-exposure',
      payload: {
        website: WEBSITE_ID,
        featureFlagKey: 'checkout',
        variation: 1,
        source: 'auto',
      },
    });
    expect(exposure.payload.idempotencyKey).toMatch(/^opaque-reference\./);
    expect(exposure.payload).not.toHaveProperty('experimentRunId');
    expect(exposure.payload).not.toHaveProperty('sessionId');
    expect(exposure.payload).not.toHaveProperty('identity');
  });

  test('an unresolved synchronous fallback never exposes and explicit capture rejects it', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      response({
        flags: { checkout: { enabled: true, value: 'control' } },
        experiments: { checkout: { resolved: false } },
      }),
    );
    const umami = await loadTracker();

    expect(umami.getFeatureValue('missing', 'fallback')).toBe('fallback');
    expect(umami.exposeFeatureFlag('missing')).toBe(false);
    await umami.flags();
    expect(umami.getFeatureValue('checkout')).toBe('control');
    expect(umami.exposeFeatureFlag('checkout')).toBe(false);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  test('data-auto-flag-exposure=false disables auto capture but explicit capture remains available', async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(resolvedFlags))
      .mockImplementation(() => response({ cache: 'cache-token' }));
    const umami = await loadTracker({ 'data-auto-flag-exposure': 'false' });
    await umami.flags();

    expect(umami.getFeatureValue('checkout')).toBe('compact');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(umami.exposeFeatureFlag('checkout')).toBe(true);
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    const exposure = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string);
    expect(exposure.payload.source).toBe('explicit');
  });

  test('retries a 5xx Exposure response then stops after success', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(resolvedFlags))
      .mockImplementationOnce(() => response({}, 503))
      .mockImplementationOnce(() => response({}, 200));
    const umami = await loadTracker();
    await umami.flags();

    expect(umami.getFeatureValue('checkout')).toBe('compact');
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  test('drops Exposure after three transient attempts and does not retry a permanent rejection', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(resolvedFlags))
      .mockImplementation(() => response({}, 503));
    const umami = await loadTracker();
    await umami.flags();
    umami.getFeatureValue('checkout');

    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);

    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockImplementation(() => response({}, 400));
    (window as any).umami = undefined;
    sessionStorage.clear();
    const next = await loadTracker();
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(resolvedFlags))
      .mockImplementation(() => response({}, 400));
    await next.flags();
    next.getFeatureValue('checkout');
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  test('tracker-disabled collection suppresses participation and Exposure transport', async () => {
    localStorage.setItem('umami.disabled', '1');
    vi.mocked(fetch).mockImplementation(() => response(resolvedFlags));
    const umami = await loadTracker();
    await umami.flags();
    const evalBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);

    expect(evalBody.participate).toBe(false);
    expect(umami.getFeatureValue('checkout')).toBe('compact');
    expect(umami.exposeFeatureFlag('checkout')).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
