import { Plus } from '@/components/icons';
import { DialogButton } from '@/components/input/DialogButton';
import { FlagEditForm } from './FlagEditForm';

export function FlagAddButton({ websiteId }: { websiteId: string }) {
  return (
    <DialogButton icon={<Plus />} label="Create flag" variant="primary" width="800px">
      {({ close }) => <FlagEditForm websiteId={websiteId} onClose={close} />}
    </DialogButton>
  );
}
