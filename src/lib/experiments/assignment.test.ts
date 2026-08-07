import { describe, expect, test } from 'vitest';
import {
  type ExperimentAssignmentAdapter,
  type ExperimentAssignmentDiagnostic,
  type ExperimentAssignmentRecord,
  type ExperimentAssignmentWrite,
  resolveExperimentAssignment,
} from './assignment';
import { createExperimentVisitorDigest } from './identity';

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_RUN_ID = '33333333-3333-4333-8333-333333333333';
const GROUP_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_KEY = '55555555-5555-4555-8555-555555555555';
const VISITOR_DIGEST = createExperimentVisitorDigest(WEBSITE_ID, 'visitor-1', {
  key: 'assignment-test-key',
});

class MemoryAssignmentAdapter implements ExperimentAssignmentAdapter {
  assignments = new Map<string, ExperimentAssignmentRecord>();
  diagnostics: ExperimentAssignmentDiagnostic[] = [];
  bindings: { sessionAssignmentKey: string; visitorDigest: string }[] = [];
  fail = false;

  private key(input: {
    experimentRunId: string;
    unitType: 'session' | 'visitor';
    unitKey: string;
  }) {
    return `${input.experimentRunId}:${input.unitType}:${input.unitKey}`;
  }

  async getAssignment(input: {
    websiteId: string;
    experimentRunId: string;
    unitType: 'session' | 'visitor';
    unitKey: string;
  }) {
    if (this.fail) throw new Error('ClickHouse unavailable');
    return this.assignments.get(this.key(input)) ?? null;
  }

  async saveFirstAssignment(input: ExperimentAssignmentWrite) {
    if (this.fail) throw new Error('ClickHouse unavailable');
    const key = this.key(input);
    const first = this.assignments.get(key);
    if (first) return first;

    const assignment: ExperimentAssignmentRecord = {
      experimentRunId: input.experimentRunId,
      variation: input.variation,
      unitType: input.unitType,
    };
    this.assignments.set(key, assignment);
    return assignment;
  }

  async bindSessionAssignment(input: ExperimentAssignmentWrite & { sessionAssignmentKey: string }) {
    this.bindings.push({
      sessionAssignmentKey: input.sessionAssignmentKey,
      visitorDigest: input.unitKey,
    });
    return this.saveFirstAssignment(input);
  }

  async getMutualExclusionAssignment(input: {
    websiteId: string;
    mutualExclusionGroupId: string;
    unitType: 'session' | 'visitor';
    unitKey: string;
  }) {
    if (this.fail) throw new Error('ClickHouse unavailable');
    for (const assignment of this.assignments.values()) {
      const metadata = assignment as ExperimentAssignmentRecord & {
        websiteId?: string;
        mutualExclusionGroupId?: string;
        unitKey?: string;
      };
      if (
        metadata.websiteId === input.websiteId &&
        metadata.mutualExclusionGroupId === input.mutualExclusionGroupId &&
        assignment.unitType === input.unitType &&
        metadata.unitKey === input.unitKey
      ) {
        return { experimentRunId: assignment.experimentRunId };
      }
    }
    return null;
  }

  async saveDiagnostic(diagnostic: ExperimentAssignmentDiagnostic) {
    this.diagnostics.push(diagnostic);
  }

  admitOtherRun(input: { unitType: 'session' | 'visitor'; unitKey: string; variation?: number }) {
    const assignment = {
      experimentRunId: OTHER_RUN_ID,
      variation: input.variation ?? 0,
      unitType: input.unitType,
      websiteId: WEBSITE_ID,
      mutualExclusionGroupId: GROUP_ID,
      unitKey: input.unitKey,
    };
    this.assignments.set(this.key({ ...input, experimentRunId: OTHER_RUN_ID }), assignment);
  }
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    run: {
      id: RUN_ID,
      websiteId: WEBSITE_ID,
      status: 'Running' as const,
      mutualExclusionGroupId: null,
    },
    evaluatedVariation: 1,
    sessionAssignmentKey: SESSION_KEY,
    ...overrides,
  };
}

describe('resolveExperimentAssignment', () => {
  test('persists and repeats the first anonymous session assignment', async () => {
    const adapter = new MemoryAssignmentAdapter();

    await expect(resolveExperimentAssignment(input(), adapter)).resolves.toMatchObject({
      variation: 1,
      unitType: 'session',
    });
    await expect(
      resolveExperimentAssignment(input({ evaluatedVariation: 0 }), adapter),
    ).resolves.toMatchObject({ variation: 1, unitType: 'session' });

    expect(adapter.assignments).toHaveLength(1);
    expect(adapter.diagnostics).toContainEqual(
      expect.objectContaining({ type: 'crossover', experimentRunId: RUN_ID }),
    );
  });

  test('persists and repeats the first identified visitor assignment', async () => {
    const adapter = new MemoryAssignmentAdapter();
    const identified = input({ visitorDigest: VISITOR_DIGEST, sessionAssignmentKey: undefined });

    await expect(resolveExperimentAssignment(identified, adapter)).resolves.toMatchObject({
      variation: 1,
      unitType: 'visitor',
    });
    await expect(
      resolveExperimentAssignment({ ...identified, evaluatedVariation: 0 }, adapter),
    ).resolves.toMatchObject({ variation: 1, unitType: 'visitor' });

    expect(adapter.assignments).toHaveLength(1);
  });

  test('binds an anonymous assignment when the same session identifies', async () => {
    const adapter = new MemoryAssignmentAdapter();
    await resolveExperimentAssignment(input({ evaluatedVariation: 0 }), adapter);

    const result = await resolveExperimentAssignment(
      input({ evaluatedVariation: 1, visitorDigest: VISITOR_DIGEST }),
      adapter,
    );

    expect(result).toMatchObject({ variation: 0, unitType: 'visitor' });
    expect(adapter.bindings).toContainEqual({
      sessionAssignmentKey: SESSION_KEY,
      visitorDigest: VISITOR_DIGEST,
    });
    await expect(
      resolveExperimentAssignment(
        input({
          evaluatedVariation: 1,
          visitorDigest: VISITOR_DIGEST,
          sessionAssignmentKey: undefined,
        }),
        adapter,
      ),
    ).resolves.toMatchObject({ variation: 0, unitType: 'visitor' });
  });

  test('returns the earlier visitor assignment and diagnoses a binding conflict', async () => {
    const adapter = new MemoryAssignmentAdapter();
    await resolveExperimentAssignment(
      input({
        visitorDigest: VISITOR_DIGEST,
        sessionAssignmentKey: undefined,
        evaluatedVariation: 0,
      }),
      adapter,
    );
    await resolveExperimentAssignment(input({ evaluatedVariation: 1 }), adapter);

    await expect(
      resolveExperimentAssignment(
        input({ visitorDigest: VISITOR_DIGEST, evaluatedVariation: 1 }),
        adapter,
      ),
    ).resolves.toMatchObject({ variation: 0, unitType: 'visitor' });
    expect(adapter.diagnostics).toContainEqual(expect.objectContaining({ type: 'crossover' }));
    expect(adapter.bindings).toContainEqual({
      sessionAssignmentKey: SESSION_KEY,
      visitorDigest: VISITOR_DIGEST,
    });
  });

  test('rejects admission when either identity is already in another Run in the group', async () => {
    const adapter = new MemoryAssignmentAdapter();
    adapter.admitOtherRun({ unitType: 'session', unitKey: SESSION_KEY });

    await expect(
      resolveExperimentAssignment(
        input({
          visitorDigest: VISITOR_DIGEST,
          run: { ...input().run, mutualExclusionGroupId: GROUP_ID },
        }),
        adapter,
      ),
    ).resolves.toBeNull();
    expect(adapter.diagnostics).toContainEqual(
      expect.objectContaining({ type: 'exclusion', reason: 'mutual-exclusion' }),
    );
  });

  test.each(['Paused', 'Draft', 'Completed', 'Finalized', 'Archived'])(
    'does not assign a %s Run',
    async status => {
      const adapter = new MemoryAssignmentAdapter();

      await expect(
        resolveExperimentAssignment(input({ run: { ...input().run, status } }), adapter),
      ).resolves.toBeNull();
      expect(adapter.assignments).toHaveLength(0);
    },
  );

  test.each([
    { sessionAssignmentKey: undefined },
    { sessionAssignmentKey: '' },
    { sessionAssignmentKey: 'not-a-uuid' },
    { visitorDigest: 'raw-user-key', sessionAssignmentKey: undefined },
  ])('returns no assignment for missing or invalid unit identifiers', async identifiers => {
    const adapter = new MemoryAssignmentAdapter();

    await expect(resolveExperimentAssignment(input(identifiers), adapter)).resolves.toBeNull();
    expect(adapter.assignments).toHaveLength(0);
    expect(adapter.diagnostics).toContainEqual(
      expect.objectContaining({ type: 'missing-identity' }),
    );
  });

  test('isolates adapter and ClickHouse failures from flag evaluation', async () => {
    const adapter = new MemoryAssignmentAdapter();
    adapter.fail = true;

    await expect(resolveExperimentAssignment(input(), adapter)).resolves.toBeNull();
    expect(adapter.diagnostics).toContainEqual(
      expect.objectContaining({ type: 'collection-failure' }),
    );
  });
});
