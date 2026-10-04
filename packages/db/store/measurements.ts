import { asc, desc, eq } from 'drizzle-orm';
import { dataSourceKindSchema } from '@uw/contracts';
import type { AnyExecutor } from '../any-database.ts';
import { measurements } from '../schema.ts';
import { checkedRows } from './limits.ts';
import { refusing } from './refusal.ts';
import type { MeasurementRow, MeasurementsGateway } from './types.ts';

async function forItem(
  executor: AnyExecutor,
  itemId: string,
  limit: number,
): Promise<readonly MeasurementRow[]> {
  const rows = await executor
    .select()
    .from(measurements)
    .where(eq(measurements.itemId, itemId))
    .orderBy(desc(measurements.asOf), desc(measurements.recordedAt), asc(measurements.id))
    .limit(checkedRows(limit, 'measurement'));
  return rows.map((row) => ({
    id: row.id,
    harnessId: row.harnessId,
    itemId,
    source: dataSourceKindSchema.parse(row.source),
    name: row.name,
    value: row.value,
    asOf: row.asOf,
    recordedAt: row.recordedAt,
  }));
}

export function bindMeasurements(executor: AnyExecutor): MeasurementsGateway {
  return {
    read: { forItem: (itemId, limit) => forItem(executor, itemId, limit) },
    write: {
      insert: (row) =>
        refusing(async () => {
          await executor.insert(measurements).values({ ...row });
        }),
    },
  };
}
