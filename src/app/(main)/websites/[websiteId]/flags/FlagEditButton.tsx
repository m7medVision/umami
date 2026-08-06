import { Edit } from '@/components/icons';
import { DialogButton } from '@/components/input/DialogButton';
import { FlagEditForm } from './FlagEditForm';

export function FlagEditButton({ websiteId, flagId }: { websiteId: string; flagId: string }) {
  return (
    <DialogButton icon={<Edit />} title="Edit flag" variant="quiet" width="800px">
      {({ close }) => <FlagEditForm websiteId={websiteId} flagId={flagId} onClose={close} />}
    </DialogButton>
  );
}
