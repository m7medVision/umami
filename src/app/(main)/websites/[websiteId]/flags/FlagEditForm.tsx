'use client';

import { Button, FormButtons, Loading } from '@umami/react-zen';
import { useEffect, useState } from 'react';
import { useMessages, useUpdateQuery, useWebsiteFlagQuery } from '@/components/hooks';

type ValueType = 'boolean' | 'string' | 'number' | 'json';
type Variation = { value: unknown };

type FlagFormState = {
  key: string;
  name: string;
  description: string;
  valueType: ValueType;
  enabled: boolean;
  variations: Variation[];
  rollout: { percentage: number; weights: number[] };
  defaultVariation: number;
};

const initialState: FlagFormState = {
  key: '',
  name: '',
  description: '',
  valueType: 'boolean',
  enabled: false,
  variations: [{ value: false }, { value: true }],
  rollout: { percentage: 100, weights: [0.5, 0.5] },
  defaultVariation: 0,
};

function evenWeights(length: number) {
  const weight = 1 / length;
  return Array.from({ length }, (_, index) =>
    index === length - 1 ? 1 - weight * (length - 1) : weight,
  );
}

function parseValue(value: string, type: ValueType) {
  if (type === 'boolean') return value === 'true';
  if (type === 'number') return Number(value);
  if (type === 'json') return JSON.parse(value);
  return value;
}

function formatValue(value: unknown, type: ValueType) {
  return type === 'json' ? JSON.stringify(value) : String(value);
}

export function FlagEditForm({
  websiteId,
  flagId,
  onClose,
}: {
  websiteId: string;
  flagId?: string;
  onClose?: () => void;
}) {
  const { data } = useWebsiteFlagQuery(websiteId, flagId);
  const { t, labels, messages, getErrorMessage } = useMessages();
  const { mutateAsync, error, isPending, touch, toast } = useUpdateQuery(
    `/websites/${websiteId}/flags${flagId ? `/${flagId}` : ''}`,
  );
  const [state, setState] = useState<FlagFormState>(initialState);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (data) {
      setState({
        key: data.key,
        name: data.name,
        description: data.description || '',
        valueType: data.valueType,
        enabled: data.enabled,
        variations: data.variations,
        rollout: data.rollout,
        defaultVariation: data.defaultVariation,
      });
    }
  }, [data]);

  const setType = (valueType: ValueType) => {
    if (valueType === 'boolean') {
      setState(current => ({
        ...current,
        valueType,
        variations: [{ value: false }, { value: true }],
        rollout: { ...current.rollout, weights: [0.5, 0.5] },
        defaultVariation: 0,
      }));
    } else {
      setState(current => ({
        ...current,
        valueType,
        variations: [
          { value: valueType === 'number' ? 0 : '' },
          { value: valueType === 'number' ? 1 : '' },
        ],
        rollout: { ...current.rollout, weights: [0.5, 0.5] },
        defaultVariation: 0,
      }));
    }
  };

  const updateVariation = (index: number, value: string) => {
    try {
      const parsed = parseValue(value, state.valueType);
      setState(current => ({
        ...current,
        variations: current.variations.map((item, itemIndex) =>
          itemIndex === index ? { value: parsed } : item,
        ),
      }));
      setLocalError('');
    } catch {
      setLocalError('JSON variations must contain valid JSON.');
    }
  };

  const addVariation = () => {
    const variations = [...state.variations, { value: state.valueType === 'number' ? 0 : '' }];
    setState(current => ({
      ...current,
      variations,
      rollout: { ...current.rollout, weights: evenWeights(variations.length) },
    }));
  };

  const removeVariation = (index: number) => {
    if (state.variations.length <= 2) return;
    const variations = state.variations.filter((_, itemIndex) => itemIndex !== index);
    setState(current => ({
      ...current,
      variations,
      defaultVariation:
        current.defaultVariation === index
          ? 0
          : Math.max(0, current.defaultVariation - (current.defaultVariation > index ? 1 : 0)),
      rollout: { ...current.rollout, weights: evenWeights(variations.length) },
    }));
  };

  const updateWeight = (index: number, percentage: number) => {
    setState(current => ({
      ...current,
      rollout: {
        ...current.rollout,
        weights: current.rollout.weights.map((weight, itemIndex) =>
          itemIndex === index ? percentage / 100 : weight,
        ),
      },
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const weightTotal = state.rollout.weights.reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(weightTotal - 1) > 0.000001) {
      setLocalError('Variation weights must sum to 100%.');
      return;
    }

    const { key, ...definition } = state;
    await mutateAsync(flagId ? definition : { key, ...definition }, {
      onSuccess: () => {
        toast(t(messages.saved));
        touch('flags');
        onClose?.();
      },
    });
  };

  if (flagId && !data) return <Loading placement="absolute" />;

  const fieldStyle = { display: 'grid', gap: 6 } as const;
  const inputStyle = { padding: '8px 10px', border: '1px solid var(--base400)', borderRadius: 4 };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 18 }}>
      <label style={fieldStyle}>
        <span>Key</span>
        <input
          style={inputStyle}
          value={state.key}
          disabled={!!flagId}
          required
          maxLength={200}
          onChange={event => setState(current => ({ ...current, key: event.target.value }))}
        />
        <small>Used in customer code. It cannot be changed after creation.</small>
      </label>
      <label style={fieldStyle}>
        <span>{t(labels.name)}</span>
        <input
          style={inputStyle}
          value={state.name}
          required
          maxLength={200}
          onChange={event => setState(current => ({ ...current, name: event.target.value }))}
        />
      </label>
      <label style={fieldStyle}>
        <span>{t(labels.description)}</span>
        <textarea
          style={inputStyle}
          value={state.description}
          onChange={event => setState(current => ({ ...current, description: event.target.value }))}
        />
      </label>
      <label style={fieldStyle}>
        <span>{t(labels.type)}</span>
        <select
          style={inputStyle}
          value={state.valueType}
          onChange={event => setType(event.target.value as ValueType)}
        >
          <option value="boolean">Boolean</option>
          <option value="string">String</option>
          <option value="number">Number</option>
          <option value="json">JSON</option>
        </select>
      </label>

      <fieldset style={{ display: 'grid', gap: 10 }}>
        <legend>Variations</legend>
        {state.variations.map((variation, index) => (
          <div
            key={index}
            style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 90px 40px', gap: 8 }}
          >
            <input
              aria-label={`Fallthrough variation ${index + 1}`}
              type="radio"
              checked={state.defaultVariation === index}
              onChange={() => setState(current => ({ ...current, defaultVariation: index }))}
            />
            {state.valueType === 'boolean' ? (
              <input style={inputStyle} value={String(variation.value)} disabled />
            ) : (
              <input
                style={inputStyle}
                value={formatValue(variation.value, state.valueType)}
                onChange={event => updateVariation(index, event.target.value)}
              />
            )}
            <label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={Math.round((state.rollout.weights[index] || 0) * 10000) / 100}
                onChange={event => updateWeight(index, Number(event.target.value))}
                style={{ ...inputStyle, width: '100%' }}
              />
            </label>
            <button
              type="button"
              disabled={state.valueType === 'boolean' || state.variations.length <= 2}
              onClick={() => removeVariation(index)}
            >
              ×
            </button>
          </div>
        ))}
        <small>Choose the Fallthrough with the radio. Weights must sum to 100%.</small>
        {state.valueType !== 'boolean' && <Button onPress={addVariation}>Add variation</Button>}
      </fieldset>

      <label style={fieldStyle}>
        <span>Traffic included: {state.rollout.percentage}%</span>
        <input
          type="range"
          min="0"
          max="100"
          value={state.rollout.percentage}
          onChange={event =>
            setState(current => ({
              ...current,
              rollout: { ...current.rollout, percentage: Number(event.target.value) },
            }))
          }
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={event => setState(current => ({ ...current, enabled: event.target.checked }))}
        />{' '}
        Enabled
      </label>

      {(localError || error) && (
        <div role="alert" style={{ color: 'var(--danger600)' }}>
          {localError || getErrorMessage(error)}
        </div>
      )}
      <FormButtons>
        <Button isDisabled={isPending} onPress={onClose}>
          {t(labels.cancel)}
        </Button>
        <Button type="submit" variant="primary" isDisabled={isPending}>
          {t(labels.save)}
        </Button>
      </FormButtons>
    </form>
  );
}
