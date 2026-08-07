import { z } from 'zod';
import { isValidTimezone, normalizeTimezone } from '@/lib/date';
import {
  EXPERIMENT_ASSIGNMENT_POLICY,
  EXPERIMENT_ATTRIBUTION_SCOPES,
  EXPERIMENT_BUCKETING_VERSION,
  EXPERIMENT_COUNTING_MODES,
  EXPERIMENT_DESIRED_DIRECTIONS,
  EXPERIMENT_OUTCOME_ROLES,
  EXPERIMENT_OUTCOME_TYPES,
  EXPERIMENT_SAFEGUARD_DEFAULTS,
  EXPERIMENT_STANDARD_METRICS,
  EXPERIMENT_STATISTICAL_MODEL,
  EXPERIMENT_STATISTICS_VERSION,
} from '@/lib/experiments/types';
import { CURRENCIES, UNIT_TYPES } from './constants';

export const timezoneParam = z
  .string()
  .refine((value: string) => isValidTimezone(value), {
    message: 'Invalid timezone',
  })
  .transform((value: string) => normalizeTimezone(value));

export const unitParam = z.string().refine(value => UNIT_TYPES.includes(value), {
  message: 'Invalid unit',
});

export const dateRangeParams = {
  startAt: z.coerce.number().optional(),
  endAt: z.coerce.number().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  timezone: timezoneParam.optional(),
  unit: unitParam.optional(),
  compare: z.enum(['prev', 'yoy']).optional(),
};

export function withDateRange<T extends z.ZodRawShape>(shape?: T) {
  return z
    .object({
      ...dateRangeParams,
      ...shape,
    })
    .superRefine((data: Record<string, unknown>, ctx) => {
      const hasTimestamps = data.startAt != null && data.endAt != null;
      const hasDates = data.startDate != null && data.endDate != null;

      if (!hasTimestamps && !hasDates) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Either startAt+endAt or startDate+endDate must be provided',
        });
      }
    });
}

export const filterParams = {
  path: z.string().optional(),
  referrer: z.string().optional(),
  title: z.string().optional(),
  query: z.string().optional(),
  os: z.string().optional(),
  browser: z.string().optional(),
  device: z.string().optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  city: z.string().optional(),
  tag: z.string().optional(),
  hostname: z.string().optional(),
  distinctId: z.string().optional(),
  language: z.string().optional(),
  event: z.string().optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  utmContent: z.string().optional(),
  utmTerm: z.string().optional(),
  segment: z.uuid().optional(),
  cohort: z.uuid().optional(),
  eventType: z.coerce.number().int().positive().optional(),
  excludeBounce: z.string().optional(),
  match: z.enum(['all', 'any']).optional(),
};

export const searchParams = {
  search: z.string().optional(),
};

export const replayParams = {
  minDuration: z.coerce.number().int().nonnegative().optional(),
};

export const pagingParams = {
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  maxResults: z.coerce.number().int().positive().optional(),
};

export const sortingParams = {
  orderBy: z.string().optional(),
  sortDescending: z
    .enum(['true', 'false'])
    .optional()
    .transform(value => {
      if (value === undefined) {
        return undefined;
      }

      return value === 'true';
    }),
};

export const userRoleParam = z.enum(['admin', 'user', 'view-only']);

export const teamRoleParam = z.enum(['team-member', 'team-view-only', 'team-manager']);

export const anyObjectParam = z.record(z.string(), z.any());

export const urlOrPathParam = z.string().refine(
  value => {
    try {
      new URL(value, 'https://localhost');
      return true;
    } catch {
      return false;
    }
  },
  {
    message: 'Invalid URL.',
  },
);

export const fieldsParam = z.enum([
  'path',
  'referrer',
  'title',
  'query',
  'os',
  'browser',
  'device',
  'country',
  'region',
  'city',
  'tag',
  'hostname',
  'distinctId',
  'language',
  'event',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
]);

export const reportTypeParam = z.enum([
  'attribution',
  'breakdown',
  'funnel',
  'goal',
  'heatmap',
  'journey',
  'performance',
  'retention',
  'revenue',
  'utm',
]);

export const operatorParam = z.enum([
  'eq',
  'neq',
  's',
  'ns',
  'c',
  'dnc',
  're',
  'nre',
  't',
  'f',
  'gt',
  'lt',
  'gte',
  'lte',
  'bf',
  'af',
]);

export const goalReportSchema = z.object({
  type: z.literal('goal'),
  parameters: z.object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    type: z.string(),
    value: z.string(),
  }),
});

export const funnelReportSchema = z.object({
  type: z.literal('funnel'),
  parameters: z.object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    window: z.coerce.number().positive(),
    steps: z
      .array(
        z.object({
          type: z.enum(['path', 'event']),
          value: z.string(),
          filters: z
            .array(
              z.object({
                property: z.string().min(1),
                operator: z.enum(['eq', 'neq', 'c', 'dnc']),
                value: z.string(),
              }),
            )
            .optional(),
        }),
      )
      .min(2)
      .max(8),
  }),
});

export const journeyReportSchema = z.object({
  type: z.literal('journey'),
  parameters: z.object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    steps: z.coerce.number().min(2).max(7),
    startStep: z.string().optional(),
    endStep: z.string().optional(),
    eventType: z.coerce.number().int().positive().optional(),
  }),
});

export const retentionReportSchema = z.object({
  type: z.literal('retention'),
  parameters: z.object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    timezone: timezoneParam.optional(),
  }),
});

export const utmReportSchema = z.object({
  type: z.literal('utm'),
  parameters: z.object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  }),
});

export const performanceReportSchema = z.object({
  type: z.literal('performance'),
  parameters: z.object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    unit: unitParam.optional(),
    timezone: timezoneParam.optional(),
    metric: z.enum(['lcp', 'inp', 'cls', 'fcp', 'ttfb']).optional(),
  }),
});

export const revenueReportSchema = z.object({
  type: z.literal('revenue'),
  parameters: z.object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    unit: unitParam.optional(),
    timezone: timezoneParam.optional(),
    currency: z.string(),
    compare: z.enum(['prev', 'yoy']).optional(),
  }),
});

export const attributionReportSchema = z.object({
  type: z.literal('attribution'),
  parameters: z.object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    model: z.enum(['first-click', 'last-click']),
    type: z.enum(['path', 'event']),
    step: z.string(),
    currency: z.string().optional(),
  }),
});

export const breakdownReportSchema = z.object({
  type: z.literal('breakdown'),
  parameters: z.object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    fields: z.array(fieldsParam),
  }),
});

export const heatmapReportSchema = z.object({
  type: z.literal('heatmap'),
  parameters: z.object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    urlPath: z.string().max(500).optional(),
    mode: z.enum(['click', 'scroll']).optional(),
  }),
});

export const reportBaseSchema = z.object({
  websiteId: z.uuid(),
  type: reportTypeParam,
  name: z.string().max(200),
  description: z.string().max(500).optional(),
  parameters: anyObjectParam,
});

export const reportTypeSchema = z.discriminatedUnion('type', [
  goalReportSchema,
  funnelReportSchema,
  journeyReportSchema,
  performanceReportSchema,
  retentionReportSchema,
  utmReportSchema,
  revenueReportSchema,
  attributionReportSchema,
  breakdownReportSchema,
  heatmapReportSchema,
]);

export const reportSchema = reportBaseSchema;

export const reportResultSchema = z.intersection(
  z.object({
    websiteId: z.uuid(),
    filters: z.object({ ...filterParams }).passthrough(),
  }),
  reportTypeSchema,
);

export const segmentTypeParam = z.enum(['segment', 'cohort']);

export const segmentParamSchema = z.object({
  filters: z
    .array(
      z.object({
        name: z.string(),
        operator: operatorParam,
        value: z.string(),
      }),
    )
    .optional(),
  match: z.enum(['all', 'any']).optional(),
  dateRange: z.string().optional(),
  action: z
    .object({
      type: z.string(),
      value: z.string(),
    })
    .optional(),
});

export const featureFlagValueTypeParam = z.enum(['boolean', 'string', 'number', 'json']);
export const featureFlagVariationSchema = z.object({ value: z.json() });
export const featureFlagRolloutSchema = z.object({
  percentage: z.number().min(0).max(100),
  weights: z.array(z.number().min(0).max(1)).optional(),
});

const featureFlagDefinitionShape = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  valueType: featureFlagValueTypeParam,
  enabled: z.boolean(),
  variations: z.array(featureFlagVariationSchema).min(2),
  rollout: featureFlagRolloutSchema,
  defaultVariation: z.number().int().nonnegative(),
};

function validateFeatureFlagDefinition(
  data: z.infer<z.ZodObject<typeof featureFlagDefinitionShape>>,
  context: z.RefinementCtx,
) {
  if (data.defaultVariation >= data.variations.length) {
    context.addIssue({
      code: 'custom',
      path: ['defaultVariation'],
      message: 'Fallthrough variation must reference an existing variation',
    });
  }

  for (const [index, variation] of data.variations.entries()) {
    const value = variation.value;
    const valid =
      data.valueType === 'json' ||
      (data.valueType === 'boolean' && typeof value === 'boolean') ||
      (data.valueType === 'string' && typeof value === 'string') ||
      (data.valueType === 'number' && typeof value === 'number');

    if (!valid) {
      context.addIssue({
        code: 'custom',
        path: ['variations', index, 'value'],
        message: `Variation must contain a ${data.valueType} value`,
      });
    }
  }

  const { weights } = data.rollout;
  if (weights) {
    if (weights.length !== data.variations.length) {
      context.addIssue({
        code: 'custom',
        path: ['rollout', 'weights'],
        message: 'Weights must contain one entry per variation',
      });
    } else if (Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 0.000001) {
      context.addIssue({
        code: 'custom',
        path: ['rollout', 'weights'],
        message: 'Weights must sum to 1',
      });
    }
  }
}

export const featureFlagCreateSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    ...featureFlagDefinitionShape,
  })
  .superRefine(validateFeatureFlagDefinition);

export const featureFlagUpdateSchema = z
  .object(featureFlagDefinitionShape)
  .superRefine(validateFeatureFlagDefinition);

export const experimentOutcomeTypeParam = z.enum(EXPERIMENT_OUTCOME_TYPES);
export const experimentOutcomeRoleParam = z.enum(EXPERIMENT_OUTCOME_ROLES);
export const experimentCountingModeParam = z.enum(EXPERIMENT_COUNTING_MODES);
export const experimentAttributionScopeParam = z.enum(EXPERIMENT_ATTRIBUTION_SCOPES);
export const experimentDesiredDirectionParam = z.enum(EXPERIMENT_DESIRED_DIRECTIONS);

const experimentOutcomeSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('standard'),
    metric: z.enum(EXPERIMENT_STANDARD_METRICS),
  }),
  z.object({
    type: z.literal('event'),
    eventName: z.string().trim().min(1).max(50),
    numericField: z.string().trim().min(1).max(500).optional(),
  }),
]);

export const experimentOutcomeSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: experimentOutcomeTypeParam,
    source: experimentOutcomeSourceSchema,
    countingMode: experimentCountingModeParam,
    attributionScope: experimentAttributionScopeParam,
    visitorWindowDays: z.number().int().min(1).max(30).default(14),
    desiredDirection: experimentDesiredDirectionParam,
    role: experimentOutcomeRoleParam,
    currency: z
      .string()
      .refine(value => CURRENCIES.some(currency => currency.id === value), {
        message: 'Currency must be supported by Umami',
      })
      .optional(),
  })
  .superRefine((outcome, context) => {
    const requiredCountingMode = {
      conversion: 'unique',
      count: 'count',
      value: 'sum',
      revenue: 'sum',
      duration: 'sum',
    }[outcome.type];

    if (outcome.countingMode !== requiredCountingMode) {
      context.addIssue({
        code: 'custom',
        path: ['countingMode'],
        message: `${outcome.type} Outcomes require ${requiredCountingMode} counting`,
      });
    }

    if (outcome.type === 'value' && outcome.source.type !== 'event') {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'Value Outcomes require an event source',
      });
    }

    if (
      (outcome.type === 'value' || outcome.type === 'duration') &&
      outcome.source.type === 'event' &&
      !outcome.source.numericField
    ) {
      context.addIssue({
        code: 'custom',
        path: ['source', 'numericField'],
        message: `${outcome.type} event Outcomes require a numeric field`,
      });
    }

    if (outcome.type === 'revenue' && !outcome.currency) {
      context.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Revenue Outcomes require exactly one currency',
      });
    } else if (outcome.type !== 'revenue' && outcome.currency) {
      context.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Currency is valid only for Revenue Outcomes',
      });
    }

    if (outcome.source.type === 'standard') {
      const validStandardMetrics = {
        conversion: ['pageview', 'visit'],
        count: ['pageview', 'visit'],
        value: [],
        revenue: ['revenue'],
        duration: ['session-duration'],
      }[outcome.type] as readonly string[];

      if (!validStandardMetrics.includes(outcome.source.metric)) {
        context.addIssue({
          code: 'custom',
          path: ['source', 'metric'],
          message: `${outcome.source.metric} is not a valid standard metric for ${outcome.type}`,
        });
      }
    }
  });

export const experimentSegmentSnapshotSchema = z.object({
  segmentId: z.uuid(),
  type: segmentTypeParam,
  name: z.string().trim().min(1).max(200),
  parameters: z.json(),
});

const experimentAssignmentPolicySchema = z
  .object({
    identified: z.literal(EXPERIMENT_ASSIGNMENT_POLICY.identified),
    anonymous: z.literal(EXPERIMENT_ASSIGNMENT_POLICY.anonymous),
  })
  .default({ ...EXPERIMENT_ASSIGNMENT_POLICY });

const experimentStatisticalModelSchema = z
  .object({
    conversion: z.object({
      model: z.literal(EXPERIMENT_STATISTICAL_MODEL.conversion.model),
      alpha: z.literal(EXPERIMENT_STATISTICAL_MODEL.conversion.alpha),
      beta: z.literal(EXPERIMENT_STATISTICAL_MODEL.conversion.beta),
    }),
    count: z.object({
      model: z.literal(EXPERIMENT_STATISTICAL_MODEL.count.model),
      shape: z.literal(EXPERIMENT_STATISTICAL_MODEL.count.shape),
      rate: z.literal(EXPERIMENT_STATISTICAL_MODEL.count.rate),
    }),
    continuous: z.object({
      model: z.literal(EXPERIMENT_STATISTICAL_MODEL.continuous.model),
    }),
  })
  .default({
    conversion: { ...EXPERIMENT_STATISTICAL_MODEL.conversion },
    count: { ...EXPERIMENT_STATISTICAL_MODEL.count },
    continuous: { ...EXPERIMENT_STATISTICAL_MODEL.continuous },
  });

export const experimentSafeguardsSchema = z
  .object({
    minimumSampleSizePerVariation: z
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(EXPERIMENT_SAFEGUARD_DEFAULTS.minimumSampleSizePerVariation),
    minimumActiveDays: z
      .number()
      .int()
      .min(1)
      .max(90)
      .default(EXPERIMENT_SAFEGUARD_DEFAULTS.minimumActiveDays),
    probabilityToWinThreshold: z
      .number()
      .min(0.5)
      .lt(1)
      .default(EXPERIMENT_SAFEGUARD_DEFAULTS.probabilityToWinThreshold),
    expectedLossThreshold: z
      .number()
      .nonnegative()
      .max(1_000_000_000)
      .default(EXPERIMENT_SAFEGUARD_DEFAULTS.expectedLossThreshold),
    sampleRatioMismatchAlpha: z
      .number()
      .gt(0)
      .max(0.1)
      .default(EXPERIMENT_SAFEGUARD_DEFAULTS.sampleRatioMismatchAlpha),
  })
  .default({ ...EXPERIMENT_SAFEGUARD_DEFAULTS });

export const experimentCreateSchema = z.object({
  featureFlagId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
});

export const experimentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
});

export const experimentRunDraftSchema = z
  .object({
    featureFlag: z.object({
      key: z.string().trim().min(1).max(200),
      valueType: featureFlagValueTypeParam,
      variations: z.array(featureFlagVariationSchema).min(2).max(10),
      rollout: featureFlagRolloutSchema.extend({
        weights: z.array(z.number().gt(0).max(1)).min(2).max(10),
      }),
      fallthroughVariation: z.number().int().nonnegative(),
    }),
    baselineVariation: z.number().int().nonnegative(),
    outcomes: z.array(experimentOutcomeSchema).min(1).max(11),
    assignmentPolicy: experimentAssignmentPolicySchema,
    audienceSegment: experimentSegmentSnapshotSchema.nullable().default(null),
    exclusionSegment: experimentSegmentSnapshotSchema.nullable().default(null),
    statisticsVersion: z
      .literal(EXPERIMENT_STATISTICS_VERSION)
      .default(EXPERIMENT_STATISTICS_VERSION),
    bucketingVersion: z.literal(EXPERIMENT_BUCKETING_VERSION).default(EXPERIMENT_BUCKETING_VERSION),
    statisticalModel: experimentStatisticalModelSchema,
    safeguards: experimentSafeguardsSchema,
  })
  .superRefine((draft, context) => {
    const variationCount = draft.featureFlag.variations.length;

    if (draft.baselineVariation >= variationCount) {
      context.addIssue({
        code: 'custom',
        path: ['baselineVariation'],
        message: 'Baseline must reference exactly one existing Variation',
      });
    }

    if (draft.featureFlag.fallthroughVariation >= variationCount) {
      context.addIssue({
        code: 'custom',
        path: ['featureFlag', 'fallthroughVariation'],
        message: 'Fallthrough must reference an existing Variation',
      });
    }

    const { weights } = draft.featureFlag.rollout;
    if (weights.length !== variationCount) {
      context.addIssue({
        code: 'custom',
        path: ['featureFlag', 'rollout', 'weights'],
        message: 'Weights must contain one entry per Variation',
      });
    } else if (Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 0.000001) {
      context.addIssue({
        code: 'custom',
        path: ['featureFlag', 'rollout', 'weights'],
        message: 'Weights must sum to 1',
      });
    }

    for (const [index, variation] of draft.featureFlag.variations.entries()) {
      const value = variation.value;
      const valid =
        draft.featureFlag.valueType === 'json' ||
        (draft.featureFlag.valueType === 'boolean' && typeof value === 'boolean') ||
        (draft.featureFlag.valueType === 'string' && typeof value === 'string') ||
        (draft.featureFlag.valueType === 'number' && typeof value === 'number');

      if (!valid) {
        context.addIssue({
          code: 'custom',
          path: ['featureFlag', 'variations', index, 'value'],
          message: `Variation must contain a ${draft.featureFlag.valueType} value`,
        });
      }
    }

    const primaryCount = draft.outcomes.filter(outcome => outcome.role === 'primary').length;
    const secondaryCount = draft.outcomes.filter(outcome => outcome.role === 'secondary').length;

    if (primaryCount !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['outcomes'],
        message: 'A Run requires exactly one Primary Outcome',
      });
    }

    if (secondaryCount > 10) {
      context.addIssue({
        code: 'custom',
        path: ['outcomes'],
        message: 'A Run allows at most ten Secondary Outcomes',
      });
    }
  });

export const experimentRunRequestSchema = z.object({
  mutualExclusionGroupId: z.uuid().nullable().optional(),
  configuration: experimentRunDraftSchema,
});

export const experimentPromoteSchema = z.object({
  winningVariation: z.number().int().nonnegative(),
});
