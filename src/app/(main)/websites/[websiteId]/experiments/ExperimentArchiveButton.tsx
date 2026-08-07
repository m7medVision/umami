'use client';

import { useRouter } from 'next/navigation';
import { ConfirmationForm } from '@/components/common/ConfirmationForm';
import { useDeleteQuery, useMessages } from '@/components/hooks';
import { DialogButton } from '@/components/input/DialogButton';

export function ExperimentArchiveButton({
  websiteId,
  experimentId,
  name,
}: {
  websiteId: string;
  experimentId: string;
  name: string;
}) {
  const router = useRouter();
  const { t, labels, messages } = useMessages();
  const { mutateAsync, isPending, error, touch } = useDeleteQuery(
    `/websites/${websiteId}/experiments/${experimentId}`,
  );

  async function confirm(close: () => void) {
    await mutateAsync(null, {
      onSuccess: () => {
        touch('experiments');
        close();
        router.push(`/websites/${websiteId}/experiments`);
      },
    });
  }

  return (
    <DialogButton title={t(labels.archive)} variant="quiet" width="600px">
      {({ close }) => (
        <ConfirmationForm
          message={t.rich(messages.confirmRemove, {
            target: name,
            b: chunks => <b>{chunks}</b>,
          })}
          isLoading={isPending}
          error={error}
          onConfirm={confirm.bind(null, close)}
          onClose={close}
          buttonLabel={t(labels.archive)}
          buttonVariant="danger"
        />
      )}
    </DialogButton>
  );
}
