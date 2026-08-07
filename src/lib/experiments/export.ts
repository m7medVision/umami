const FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;

export function formulaSafeCsvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  const safe = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function createExperimentAggregateCsv(payload: any, mode: 'session' | 'visitor') {
  const result = payload?.results ?? payload;
  const selected = result?.modes?.[mode];
  const variations = Array.isArray(result?.variations) ? result.variations : [];
  const rows = [
    [
      'mode',
      'outcome',
      'role',
      'variation',
      'exposed_units',
      'value',
      'rate',
      'probability_to_win',
      'uplift_low',
      'uplift_high',
      'expected_loss',
    ],
  ];
  for (const outcome of selected?.outcomes ?? []) {
    for (const total of outcome.totals ?? []) {
      const variation = outcome.statistics?.variations?.find(
        (item: any) => item.variation === total.variation,
      );
      rows.push([
        mode,
        outcome.name,
        outcome.role,
        variations[total.variation]?.name ?? `Variation ${total.variation + 1}`,
        total.exposed,
        total.value,
        total.rate,
        variation?.probabilityToWin ?? '',
        variation?.uplift?.credibleInterval?.[0] ?? '',
        variation?.uplift?.credibleInterval?.[1] ?? '',
        variation?.expectedLoss ?? '',
      ] as any);
    }
  }
  return `${rows.map(row => row.map(formulaSafeCsvCell).join(',')).join('\n')}\n`;
}

/** Explicit allowlist: configuration only, never assignments, digests, Exposures, or results. */
export function createExperimentFrozenConfigExport(run: any) {
  return {
    version: 1,
    runNumber: run.runNumber,
    featureFlag: {
      key: run.featureFlagKey,
      valueType: run.featureFlagValueType,
      variations: run.featureFlagVariations,
      rolloutPercentage: run.rolloutPercentage,
      variationWeights: run.variationWeights,
      fallthroughVariation: run.fallthroughVariation,
    },
    baselineVariation: run.baselineVariation,
    assignmentPolicy: run.assignmentPolicy,
    audienceSegment: run.audienceSegmentSnapshot,
    exclusionSegment: run.exclusionSegmentSnapshot,
    statisticsVersion: run.statisticsVersion,
    bucketingVersion: run.bucketingVersion,
    statisticalModel: run.statisticalModel,
    safeguards: run.safeguards,
    outcomes: (run.outcomes ?? []).map((outcome: any) => ({
      position: outcome.position,
      name: outcome.name,
      type: outcome.type,
      sourceType: outcome.sourceType,
      sourceValue: outcome.sourceValue,
      numericField: outcome.numericField,
      countingMode: outcome.countingMode,
      attributionScope: outcome.attributionScope,
      visitorWindowDays: outcome.visitorWindowDays,
      desiredDirection: outcome.desiredDirection,
      role: outcome.role,
      currency: outcome.currency,
    })),
  };
}
