'use client';

import { Button, Column, FormButtons, Row, useToast } from '@umami/react-zen';
import { useEffect, useMemo, useState } from 'react';
import {
  useApi,
  useExperimentSetupOptionsQuery,
  useMessages,
  useModified,
} from '@/components/hooks';
import { CURRENCIES } from '@/lib/constants';
import { calculateExperimentSampleGuidance } from '@/lib/experiments/sampleCalculator';
import { EXPERIMENT_SAFEGUARD_DEFAULTS } from '@/lib/experiments/types';
import { experimentRunRequestSchema } from '@/lib/schema';

type OutcomeType = 'conversion' | 'count' | 'value' | 'revenue' | 'duration';
type Outcome = {
  name: string;
  type: OutcomeType;
  sourceType: 'event' | 'standard';
  sourceValue: string;
  numericField: string;
  countingMode: 'unique' | 'count' | 'sum';
  attributionScope: 'session' | 'visitor' | 'both';
  visitorWindowDays: number;
  desiredDirection: 'increase' | 'decrease';
  role: 'primary' | 'secondary';
  currency: string;
};

type FeatureFlagOption = {
  id: string;
  key: string;
  name: string;
  valueType: 'boolean' | 'string' | 'number' | 'json';
  variations: { value: unknown; name?: string }[];
  rollout: { percentage: number; weights?: number[] };
  defaultVariation: number;
};

type SegmentOption = { id: string; name: string; type: string; parameters: unknown };

type Safeguards = typeof EXPERIMENT_SAFEGUARD_DEFAULTS;

const fieldStyle = { display: 'grid', gap: 6 } as const;
const inputStyle = {
  padding: '8px 10px',
  border: '1px solid var(--base400)',
  borderRadius: 4,
} as const;

function evenWeights(length: number) {
  const weight = 1 / length;
  return Array.from({ length }, (_, index) =>
    index === length - 1 ? 1 - weight * (length - 1) : weight,
  );
}

function defaultSource(type: OutcomeType) {
  if (type === 'revenue') return { sourceType: 'standard' as const, sourceValue: 'revenue' };
  if (type === 'duration')
    return { sourceType: 'standard' as const, sourceValue: 'session-duration' };
  if (type === 'value') return { sourceType: 'event' as const, sourceValue: '' };
  return { sourceType: 'event' as const, sourceValue: '' };
}

function countingMode(type: OutcomeType): Outcome['countingMode'] {
  if (type === 'conversion') return 'unique';
  if (type === 'count') return 'count';
  return 'sum';
}

function newOutcome(role: Outcome['role']): Outcome {
  return {
    name: role === 'primary' ? 'Primary outcome' : 'Secondary outcome',
    type: 'conversion',
    sourceType: 'event',
    sourceValue: '',
    numericField: '',
    countingMode: 'unique',
    attributionScope: 'both',
    visitorWindowDays: 14,
    desiredDirection: 'increase',
    role,
    currency: 'USD',
  };
}

function segmentSnapshot(segment: SegmentOption | undefined) {
  return segment
    ? {
        segmentId: segment.id,
        type: segment.type,
        name: segment.name,
        parameters: segment.parameters,
      }
    : null;
}

export function ExperimentSetupForm({
  websiteId,
  onClose,
}: {
  websiteId: string;
  onClose?: () => void;
}) {
  const { t, labels, messages, getErrorMessage } = useMessages();
  const options = useExperimentSetupOptionsQuery(websiteId);
  const { post } = useApi();
  const { touch } = useModified();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [featureFlagId, setFeatureFlagId] = useState('');
  const [baselineVariation, setBaselineVariation] = useState(0);
  const [weights, setWeights] = useState<number[]>([]);
  const [rolloutPercentage, setRolloutPercentage] = useState(100);
  const [audienceSegmentId, setAudienceSegmentId] = useState('');
  const [exclusionSegmentId, setExclusionSegmentId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [outcomes, setOutcomes] = useState<Outcome[]>([newOutcome('primary')]);
  const [safeguards, setSafeguards] = useState<Safeguards>({
    ...EXPERIMENT_SAFEGUARD_DEFAULTS,
  });
  const [baselineRate, setBaselineRate] = useState(10);
  const [minimumDetectableEffect, setMinimumDetectableEffect] = useState(2);
  const [expectedDailyTraffic, setExpectedDailyTraffic] = useState(1000);
  const [startAfterCreate, setStartAfterCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const flags = (options.data?.featureFlags ?? []) as FeatureFlagOption[];
  const segments = (options.data?.segments ?? []) as SegmentOption[];
  const groups = options.data?.mutualExclusionGroups ?? [];
  const flag = flags.find(item => item.id === featureFlagId);

  useEffect(() => {
    if (!featureFlagId && flags[0]) setFeatureFlagId(flags[0].id);
  }, [featureFlagId, flags]);

  useEffect(() => {
    if (!flag) return;
    const nextWeights = flag.rollout.weights;
    setWeights(
      nextWeights?.length === flag.variations.length && nextWeights.every(value => value > 0)
        ? nextWeights
        : evenWeights(flag.variations.length),
    );
    setRolloutPercentage(flag.rollout.percentage);
    setBaselineVariation(flag.defaultVariation);
  }, [flag]);

  const guidance = useMemo(() => {
    try {
      return flag
        ? calculateExperimentSampleGuidance({
            baselineRate: baselineRate / 100,
            minimumDetectableEffect: minimumDetectableEffect / 100,
            expectedDailyTraffic,
            variationCount: flag.variations.length,
          })
        : null;
    } catch {
      return null;
    }
  }, [baselineRate, expectedDailyTraffic, flag, minimumDetectableEffect]);

  function updateOutcome(index: number, change: Partial<Outcome>) {
    setOutcomes(current =>
      current.map((outcome, itemIndex) =>
        itemIndex === index ? { ...outcome, ...change } : outcome,
      ),
    );
  }

  function setOutcomeType(index: number, type: OutcomeType) {
    updateOutcome(index, {
      type,
      countingMode: countingMode(type),
      numericField: '',
      currency: type === 'revenue' ? 'USD' : '',
      ...defaultSource(type),
    });
  }

  function setPrimary(index: number) {
    setOutcomes(current =>
      current.map((outcome, itemIndex) => ({
        ...outcome,
        role: itemIndex === index ? 'primary' : 'secondary',
      })),
    );
  }

  function addOutcome() {
    if (outcomes.length < 11) setOutcomes(current => [...current, newOutcome('secondary')]);
  }

  function removeOutcome(index: number) {
    setOutcomes(current => {
      const removedPrimary = current[index]?.role === 'primary';
      const remaining = current.filter((_, itemIndex) => itemIndex !== index);
      return removedPrimary && remaining[0]
        ? remaining.map((outcome, itemIndex) => ({
            ...outcome,
            role: itemIndex === 0 ? 'primary' : 'secondary',
          }))
        : remaining;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!flag) return;
    setBusy(true);
    setError(undefined);
    try {
      const configuration = {
        featureFlag: {
          key: flag.key,
          valueType: flag.valueType,
          variations: flag.variations.map(variation => ({ value: variation.value })),
          rollout: { percentage: rolloutPercentage, weights },
          fallthroughVariation: flag.defaultVariation,
        },
        baselineVariation,
        audienceSegment: segmentSnapshot(
          segments.find(segment => segment.id === audienceSegmentId),
        ),
        exclusionSegment: segmentSnapshot(
          segments.find(segment => segment.id === exclusionSegmentId),
        ),
        outcomes: outcomes.map(outcome => ({
          name: outcome.name,
          type: outcome.type,
          source:
            outcome.sourceType === 'event'
              ? {
                  type: 'event',
                  eventName: outcome.sourceValue,
                  ...(outcome.numericField ? { numericField: outcome.numericField } : {}),
                }
              : { type: 'standard', metric: outcome.sourceValue },
          countingMode: outcome.countingMode,
          attributionScope: outcome.attributionScope,
          visitorWindowDays: outcome.visitorWindowDays,
          desiredDirection: outcome.desiredDirection,
          role: outcome.role,
          ...(outcome.type === 'revenue' ? { currency: outcome.currency } : {}),
        })),
        safeguards,
      };
      const runRequest = { mutualExclusionGroupId: groupId || null, configuration };
      const validation = experimentRunRequestSchema.safeParse(runRequest);
      if (!validation.success) {
        setError(validation.error.issues[0]?.message ?? t(messages.badRequest));
        return;
      }
      const experiment = await post(`/websites/${websiteId}/experiments`, {
        featureFlagId: flag.id,
        name,
        description: description || null,
      });
      const run = await post(
        `/websites/${websiteId}/experiments/${experiment.id}/runs`,
        validation.data,
      );
      if (startAfterCreate) {
        await post(
          `/websites/${websiteId}/experiments/${experiment.id}/runs/${run.id}/actions/start`,
          {},
        );
      }
      touch('experiments');
      toast(t(messages.experimentCreated));
      onClose?.();
    } catch (cause) {
      setError(getErrorMessage(cause as Error));
    } finally {
      setBusy(false);
    }
  }

  if (options.isLoading) return <p>{t(messages.loadingExperimentSetup)}</p>;
  if (options.error) return <p role="alert">{getErrorMessage(options.error)}</p>;
  if (!options.data?.permissions?.canEdit)
    return <p role="alert">{t(messages.experimentEditorRequired)}</p>;
  if (!flags.length) return <p>{t(messages.experimentFlagRequired)}</p>;

  const variationCountValid = !!flag && flag.variations.length >= 2 && flag.variations.length <= 10;

  return (
    <form onSubmit={submit}>
      <Column gap="5">
        <section>
          <h2>{t(labels.experimentDefinition)}</h2>
          <Column gap="3">
            <label style={fieldStyle}>
              <span>{t(labels.name)}</span>
              <input
                style={inputStyle}
                required
                maxLength={200}
                value={name}
                onChange={event => setName(event.currentTarget.value)}
              />
            </label>
            <label style={fieldStyle}>
              <span>{t(labels.description)}</span>
              <textarea
                style={inputStyle}
                maxLength={5000}
                value={description}
                onChange={event => setDescription(event.currentTarget.value)}
              />
            </label>
            <label style={fieldStyle}>
              <span>{t(labels.featureFlag)}</span>
              <select
                style={inputStyle}
                required
                value={featureFlagId}
                onChange={event => setFeatureFlagId(event.currentTarget.value)}
              >
                {flags.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.key})
                  </option>
                ))}
              </select>
            </label>
          </Column>
        </section>

        <section>
          <h2>{t(labels.variationsAndBaseline)}</h2>
          {!variationCountValid && <p role="alert">{t(messages.experimentVariationLimit)}</p>}
          <p>{t(messages.experimentVariationFrozen)}</p>
          {flag?.variations.map((variation, index) => (
            <Row key={index} gap="2" alignItems="center" wrap="wrap">
              <input
                type="radio"
                name="baseline"
                aria-label={`${t(labels.baseline)} ${index + 1}`}
                checked={baselineVariation === index}
                onChange={() => setBaselineVariation(index)}
              />
              <code>{variation.name ?? JSON.stringify(variation.value)}</code>
              <label>
                {t(labels.trafficWeight)}{' '}
                <input
                  style={{ ...inputStyle, width: 100 }}
                  type="number"
                  disabled
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={Math.round((weights[index] ?? 0) * 10000) / 100}
                  onChange={event =>
                    setWeights(current =>
                      current.map((weight, itemIndex) =>
                        itemIndex === index ? Number(event.currentTarget.value) / 100 : weight,
                      ),
                    )
                  }
                />
                %
              </label>
              {index === flag.defaultVariation && <strong>{t(labels.fallthrough)}</strong>}
            </Row>
          ))}
          <label style={fieldStyle}>
            <span>{t(labels.rolloutPercentage)}</span>
            <input
              style={inputStyle}
              type="number"
              disabled
              min="0"
              max="100"
              value={rolloutPercentage}
              onChange={event => setRolloutPercentage(Number(event.currentTarget.value))}
            />
          </label>
          <small>{t(messages.experimentBaselineFallthrough)}</small>
        </section>

        <section>
          <h2>{t(labels.audienceAndInterference)}</h2>
          <Column gap="3">
            <label style={fieldStyle}>
              <span>{t(labels.audienceSegment)}</span>
              <select
                style={inputStyle}
                value={audienceSegmentId}
                onChange={event => setAudienceSegmentId(event.currentTarget.value)}
              >
                <option value="">{t(labels.all)}</option>
                {segments.map(segment => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldStyle}>
              <span>{t(labels.exclusionSegment)}</span>
              <select
                style={inputStyle}
                value={exclusionSegmentId}
                onChange={event => setExclusionSegmentId(event.currentTarget.value)}
              >
                <option value="">{t(labels.none)}</option>
                {segments.map(segment => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldStyle}>
              <span>{t(labels.mutualExclusionGroup)}</span>
              <select
                style={inputStyle}
                value={groupId}
                onChange={event => setGroupId(event.currentTarget.value)}
              >
                <option value="">{t(labels.none)}</option>
                {groups.map((group: any) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <small>{t(messages.experimentInterferenceWarning)}</small>
            <small>{t(messages.experimentSegmentsFrozen)}</small>
          </Column>
        </section>

        <section>
          <Row justifyContent="space-between" alignItems="center">
            <h2>{t(labels.outcomes)}</h2>
            <Button onPress={addOutcome} isDisabled={outcomes.length >= 11}>
              {t(labels.addOutcome)}
            </Button>
          </Row>
          <p>{t(messages.experimentOutcomeLimit)}</p>
          <Column gap="4">
            {outcomes.map((outcome, index) => (
              <fieldset key={index} style={{ display: 'grid', gap: 10 }}>
                <legend>
                  {outcome.role === 'primary'
                    ? t(labels.primaryOutcome)
                    : t(labels.secondaryOutcome)}
                </legend>
                <label>
                  <input
                    type="radio"
                    name="primary-outcome"
                    checked={outcome.role === 'primary'}
                    onChange={() => setPrimary(index)}
                  />{' '}
                  {t(labels.makePrimary)}
                </label>
                <label style={fieldStyle}>
                  <span>{t(labels.name)}</span>
                  <input
                    style={inputStyle}
                    required
                    value={outcome.name}
                    onChange={event => updateOutcome(index, { name: event.currentTarget.value })}
                  />
                </label>
                <Row gap="2" wrap="wrap">
                  <label style={fieldStyle}>
                    <span>{t(labels.outcomeType)}</span>
                    <select
                      style={inputStyle}
                      value={outcome.type}
                      onChange={event =>
                        setOutcomeType(index, event.currentTarget.value as OutcomeType)
                      }
                    >
                      {['conversion', 'count', 'value', 'revenue', 'duration'].map(type => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={fieldStyle}>
                    <span>{t(labels.outcomeSource)}</span>
                    <select
                      style={inputStyle}
                      value={outcome.sourceType}
                      onChange={event =>
                        updateOutcome(index, {
                          sourceType: event.currentTarget.value as Outcome['sourceType'],
                          sourceValue: '',
                        })
                      }
                    >
                      <option value="event">{t(labels.event)}</option>
                      <option value="standard">{t(labels.standardMetric)}</option>
                    </select>
                  </label>
                  <label style={fieldStyle}>
                    <span>
                      {outcome.sourceType === 'event'
                        ? t(labels.eventName)
                        : t(labels.standardMetric)}
                    </span>
                    {outcome.sourceType === 'event' ? (
                      <input
                        style={inputStyle}
                        required
                        maxLength={50}
                        value={outcome.sourceValue}
                        onChange={event =>
                          updateOutcome(index, { sourceValue: event.currentTarget.value })
                        }
                      />
                    ) : (
                      <select
                        style={inputStyle}
                        required
                        value={outcome.sourceValue}
                        onChange={event =>
                          updateOutcome(index, { sourceValue: event.currentTarget.value })
                        }
                      >
                        <option value="">{t(labels.select)}</option>
                        <option value="pageview">pageview</option>
                        <option value="visit">visit</option>
                        <option value="revenue">revenue</option>
                        <option value="session-duration">session-duration</option>
                      </select>
                    )}
                  </label>
                </Row>
                {(outcome.type === 'value' || outcome.type === 'duration') &&
                  outcome.sourceType === 'event' && (
                    <label style={fieldStyle}>
                      <span>{t(labels.numericField)}</span>
                      <input
                        style={inputStyle}
                        required
                        value={outcome.numericField}
                        onChange={event =>
                          updateOutcome(index, { numericField: event.currentTarget.value })
                        }
                      />
                    </label>
                  )}
                <Row gap="2" wrap="wrap">
                  <label style={fieldStyle}>
                    <span>{t(labels.countingMode)}</span>
                    <select
                      style={inputStyle}
                      value={outcome.countingMode}
                      onChange={event =>
                        updateOutcome(index, {
                          countingMode: event.currentTarget.value as Outcome['countingMode'],
                        })
                      }
                    >
                      <option value="unique">unique</option>
                      <option value="count">count</option>
                      <option value="sum">sum</option>
                    </select>
                  </label>
                  <label style={fieldStyle}>
                    <span>{t(labels.attributionScope)}</span>
                    <select
                      style={inputStyle}
                      value={outcome.attributionScope}
                      onChange={event =>
                        updateOutcome(index, {
                          attributionScope: event.currentTarget
                            .value as Outcome['attributionScope'],
                        })
                      }
                    >
                      <option value="session">session</option>
                      <option value="visitor">visitor</option>
                      <option value="both">both</option>
                    </select>
                  </label>
                  <label style={fieldStyle}>
                    <span>{t(labels.visitorWindowDays)}</span>
                    <input
                      style={inputStyle}
                      type="number"
                      min="1"
                      max="30"
                      value={outcome.visitorWindowDays}
                      onChange={event =>
                        updateOutcome(index, {
                          visitorWindowDays: Number(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                  <label style={fieldStyle}>
                    <span>{t(labels.desiredDirection)}</span>
                    <select
                      style={inputStyle}
                      value={outcome.desiredDirection}
                      onChange={event =>
                        updateOutcome(index, {
                          desiredDirection: event.currentTarget
                            .value as Outcome['desiredDirection'],
                        })
                      }
                    >
                      <option value="increase">increase</option>
                      <option value="decrease">decrease</option>
                    </select>
                  </label>
                  {outcome.type === 'revenue' && (
                    <label style={fieldStyle}>
                      <span>{t(labels.currency)}</span>
                      <select
                        style={inputStyle}
                        value={outcome.currency}
                        onChange={event =>
                          updateOutcome(index, { currency: event.currentTarget.value })
                        }
                      >
                        {CURRENCIES.map(currency => (
                          <option key={currency.id} value={currency.id}>
                            {currency.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </Row>
                {outcomes.length > 1 && (
                  <Button onPress={() => removeOutcome(index)}>{t(labels.removeOutcome)}</Button>
                )}
              </fieldset>
            ))}
          </Column>
        </section>

        <section>
          <h2>{t(labels.safeguards)}</h2>
          <Row gap="2" wrap="wrap">
            {(
              [
                ['minimumSampleSizePerVariation', labels.minimumSamplePerVariation, 1, 1000000, 1],
                ['minimumActiveDays', labels.minimumActiveDays, 1, 90, 1],
                ['probabilityToWinThreshold', labels.probabilityToWinThreshold, 0.5, 0.9999, 0.01],
                ['expectedLossThreshold', labels.expectedLossThreshold, 0, 1000000000, 0.001],
                ['sampleRatioMismatchAlpha', labels.sampleRatioMismatchAlpha, 0.0001, 0.1, 0.001],
              ] as const
            ).map(([key, label, min, max, step]) => (
              <label key={key} style={fieldStyle}>
                <span>{t(label)}</span>
                <input
                  style={inputStyle}
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={safeguards[key]}
                  onChange={event =>
                    setSafeguards(current => ({
                      ...current,
                      [key]: Number(event.currentTarget.value),
                    }))
                  }
                />
              </label>
            ))}
          </Row>
        </section>

        <section>
          <h2>{t(labels.sampleRuntimeGuidance)}</h2>
          <p>{t(messages.experimentGuidanceOnly)}</p>
          <Row gap="2" wrap="wrap">
            <label style={fieldStyle}>
              <span>{t(labels.baselineRatePercent)}</span>
              <input
                style={inputStyle}
                type="number"
                min="0.01"
                max="99.99"
                step="0.01"
                value={baselineRate}
                onChange={event => setBaselineRate(Number(event.currentTarget.value))}
              />
            </label>
            <label style={fieldStyle}>
              <span>{t(labels.minimumDetectableEffectPercent)}</span>
              <input
                style={inputStyle}
                type="number"
                min="0.01"
                max="99.99"
                step="0.01"
                value={minimumDetectableEffect}
                onChange={event => setMinimumDetectableEffect(Number(event.currentTarget.value))}
              />
            </label>
            <label style={fieldStyle}>
              <span>{t(labels.expectedDailyTraffic)}</span>
              <input
                style={inputStyle}
                type="number"
                min="1"
                value={expectedDailyTraffic}
                onChange={event => setExpectedDailyTraffic(Number(event.currentTarget.value))}
              />
            </label>
          </Row>
          {guidance && (
            <p>
              {guidance.sampleSizePerVariation.toLocaleString()} {t(labels.unitsPerVariation)} ·{' '}
              {guidance.estimatedRuntimeDays} {t(labels.estimatedDays)}
            </p>
          )}
        </section>

        <section>
          <h2>{t(labels.reviewFrozenSnapshot)}</h2>
          <details open>
            <summary>{t(labels.review)}</summary>
            <ul>
              <li>
                {flag?.name} · {flag?.variations.length} {t(labels.variations)}
              </li>
              <li>
                {t(labels.baseline)}: {baselineVariation + 1}; {t(labels.fallthrough)}:{' '}
                {(flag?.defaultVariation ?? 0) + 1}
              </li>
              <li>
                {outcomes.filter(outcome => outcome.role === 'primary').length}{' '}
                {t(labels.primaryOutcome)};{' '}
                {outcomes.filter(outcome => outcome.role === 'secondary').length}{' '}
                {t(labels.secondaryOutcomes)}
              </li>
              <li>
                {audienceSegmentId ? t(labels.audienceSegment) : t(labels.all)} ·{' '}
                {exclusionSegmentId ? t(labels.exclusionSegment) : t(labels.none)}
              </li>
              <li>
                {groupId ? t(labels.mutualExclusionGroup) : t(messages.experimentNoExclusionGroup)}
              </li>
            </ul>
          </details>
          <Column gap="1">
            <strong>{t(messages.experimentFutureOnlyWarning)}</strong>
            <strong>{t(messages.experimentAwaitFlagsWarning)}</strong>
            <strong>{t(messages.experimentSecurityWarning)}</strong>
          </Column>
          <label>
            <input
              type="checkbox"
              checked={startAfterCreate}
              onChange={event => setStartAfterCreate(event.currentTarget.checked)}
            />{' '}
            {t(labels.startAfterCreate)}
          </label>
        </section>

        {error && <p role="alert">{error}</p>}
        <FormButtons>
          <Button isDisabled={busy} onPress={onClose}>
            {t(labels.cancel)}
          </Button>
          <Button type="submit" variant="primary" isDisabled={busy || !variationCountValid}>
            {startAfterCreate ? t(labels.createAndStart) : t(labels.createDraft)}
          </Button>
        </FormButtons>
      </Column>
    </form>
  );
}
