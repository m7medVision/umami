'use client';

import { Switch } from '@umami/react-zen';
import { useEffect, useState } from 'react';
import { useUpdateQuery } from '@/components/hooks';
import type { FeatureFlag } from '@/generated/prisma/client';

export function FlagEnabledToggle({ websiteId, flag }: { websiteId: string; flag: FeatureFlag }) {
  const { mutateAsync, isPending, touch } = useUpdateQuery(
    `/websites/${websiteId}/flags/${flag.id}`,
  );
  const [selected, setSelected] = useState(flag.enabled);

  useEffect(() => setSelected(flag.enabled), [flag.enabled]);

  const handleChange = async (enabled: boolean) => {
    setSelected(enabled);
    try {
      await mutateAsync(
        {
          name: flag.name,
          description: flag.description || undefined,
          valueType: flag.valueType,
          enabled,
          variations: flag.variations,
          rollout: flag.rollout,
          defaultVariation: flag.defaultVariation,
        },
        { onSuccess: () => touch('flags') },
      );
    } catch {
      setSelected(flag.enabled);
    }
  };

  return (
    <Switch
      aria-label={`Toggle ${flag.name}`}
      isSelected={selected}
      isDisabled={isPending}
      onChange={handleChange}
    />
  );
}
