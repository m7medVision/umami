import { z } from 'zod';
import { isValidTimezone, normalizeTimezone } from '@/lib/date';
import { UNIT_TYPES } from './constants';

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

const featureFlagDefinitionShape = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  valueType: featureFlagValueTypeParam,
  enabled: z.boolean(),
  variations: z.array(z.object({ value: z.json() })).min(2),
  rollout: z.object({
    percentage: z.number().min(0).max(100),
    weights: z.array(z.number().min(0).max(1)).optional(),
  }),
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
