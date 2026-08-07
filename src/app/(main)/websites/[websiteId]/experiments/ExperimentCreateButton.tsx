import { useMessages } from '@/components/hooks';
import { Plus } from '@/components/icons';
import { DialogButton } from '@/components/input/DialogButton';
import { ExperimentSetupForm } from './ExperimentSetupForm';

export function ExperimentCreateButton({ websiteId }: { websiteId: string }) {
  const { t, labels } = useMessages();
  return (
    <DialogButton
      icon={<Plus />}
      label={t(labels.createExperiment)}
      variant="primary"
      width="900px"
    >
      {({ close }) => <ExperimentSetupForm websiteId={websiteId} onClose={close} />}
    </DialogButton>
  );
}
