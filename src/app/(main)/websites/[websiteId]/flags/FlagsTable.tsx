import { Button, DataColumn, DataTable, type DataTableProps, Icon, Row } from '@umami/react-zen';
import { DateDistance } from '@/components/common/DateDistance';
import { Copy } from '@/components/icons';
import type { FeatureFlag } from '@/generated/prisma/client';
import { FlagDeleteButton } from './FlagDeleteButton';
import { FlagEditButton } from './FlagEditButton';
import { FlagEnabledToggle } from './FlagEnabledToggle';
import { FlagTestButton } from './FlagTestButton';

export function FlagsTable({ websiteId, ...props }: DataTableProps & { websiteId: string }) {
  return (
    <DataTable {...props}>
      <DataColumn id="key" label="Key">
        {(flag: FeatureFlag) => (
          <Row alignItems="center">
            <code>{flag.key}</code>
            <Button
              variant="quiet"
              aria-label={`Copy ${flag.key}`}
              onPress={() => navigator.clipboard.writeText(flag.key)}
            >
              <Icon>
                <Copy />
              </Icon>
            </Button>
          </Row>
        )}
      </DataColumn>
      <DataColumn id="name" label="Name">
        {(flag: FeatureFlag) => flag.name}
      </DataColumn>
      <DataColumn id="valueType" label="Type">
        {(flag: FeatureFlag) => flag.valueType}
      </DataColumn>
      <DataColumn id="enabled" label="Enabled">
        {(flag: FeatureFlag) => <FlagEnabledToggle websiteId={websiteId} flag={flag} />}
      </DataColumn>
      <DataColumn id="rollout" label="Rollout">
        {(flag: FeatureFlag) => `${(flag.rollout as { percentage: number }).percentage}%`}
      </DataColumn>
      <DataColumn id="updated" label="Updated">
        {(flag: FeatureFlag) => <DateDistance date={new Date(flag.updatedAt || flag.createdAt)} />}
      </DataColumn>
      <DataColumn id="action" align="end" width="150px">
        {(flag: FeatureFlag) => (
          <Row>
            <FlagTestButton websiteId={websiteId} flagId={flag.id} />
            <FlagEditButton websiteId={websiteId} flagId={flag.id} />
            <FlagDeleteButton websiteId={websiteId} flagId={flag.id} name={flag.name} />
          </Row>
        )}
      </DataColumn>
    </DataTable>
  );
}
