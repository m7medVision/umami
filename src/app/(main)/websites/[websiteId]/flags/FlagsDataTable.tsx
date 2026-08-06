import { DataGrid } from '@/components/common/DataGrid';
import { Empty } from '@/components/common/Empty';
import { useWebsiteFlagsQuery } from '@/components/hooks';
import { FlagAddButton } from './FlagAddButton';
import { FlagsTable } from './FlagsTable';

export function FlagsDataTable({ websiteId }: { websiteId: string }) {
  const query = useWebsiteFlagsQuery(websiteId);

  return (
    <DataGrid
      query={query}
      allowSearch={true}
      autoFocus={false}
      allowPaging={true}
      renderActions={() => <FlagAddButton websiteId={websiteId} />}
      renderEmpty={() => <Empty message="No flags yet." />}
    >
      {({ data }) => <FlagsTable websiteId={websiteId} data={data} />}
    </DataGrid>
  );
}
