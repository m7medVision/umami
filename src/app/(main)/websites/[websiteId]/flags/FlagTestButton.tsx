'use client';

import { Button } from '@umami/react-zen';
import { useState } from 'react';
import { useUpdateQuery } from '@/components/hooks';
import { FlaskConical } from '@/components/icons';
import { DialogButton } from '@/components/input/DialogButton';

export function FlagTestButton({ websiteId, flagId }: { websiteId: string; flagId: string }) {
  const [userKey, setUserKey] = useState('');
  const [result, setResult] = useState<{ value: unknown; reason: string }>();
  const { mutateAsync, error, isPending } = useUpdateQuery(
    `/websites/${websiteId}/flags/${flagId}/test`,
  );

  const handleTest = async () => {
    const data = await mutateAsync({ userKey });
    setResult(data);
  };

  return (
    <DialogButton icon={<FlaskConical />} title="Test flag" variant="quiet" width="600px">
      {() => (
        <div style={{ display: 'grid', gap: 16 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>User key</span>
            <input
              value={userKey}
              onChange={event => setUserKey(event.target.value)}
              placeholder="user-123"
              style={{ padding: '8px 10px' }}
            />
          </label>
          <Button variant="primary" isDisabled={!userKey || isPending} onPress={handleTest}>
            Evaluate
          </Button>
          {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
          {error && <div role="alert">Unable to evaluate this flag.</div>}
        </div>
      )}
    </DialogButton>
  );
}
