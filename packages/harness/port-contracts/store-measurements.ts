import { describe, expect, it } from 'vitest';
import type { MeasurementRow, Store } from '../ports.ts';
import { at, hour, itemOf, seedHarness, uid } from './store-gateway-fixtures.ts';

type MeasurementsSubject = () => { readonly store: Store };

const base = 0x6300;

function measurementOf(n: number, item: number, asOf: string, recorded: number): MeasurementRow {
  return {
    id: uid(base + 0x40 + n),
    harnessId: uid(base),
    itemId: uid(base + 10 + item),
    source: 'web_analytics',
    name: `visitors ${n}`,
    value: n + 0.5,
    asOf,
    recordedAt: new Date(at.getTime() + recorded * hour),
  };
}

export function describeStoreMeasurements(adapter: string, subject: MeasurementsSubject): void {
  describe(`DX-3 store measurements gateway on ${adapter}`, () => {
    it('measurements for an item come newest first and at most the limit', async () => {
      const oldest = measurementOf(1, 1, '2026-09-01', 0);
      const newest = measurementOf(2, 1, '2026-09-20', 0);
      const sameDayLater = measurementOf(3, 1, '2026-09-10', 2);
      const sameDayEarlier = measurementOf(4, 1, '2026-09-10', 1);
      const otherItem = measurementOf(5, 2, '2026-09-30', 0);
      const read = await subject().store.transaction(async (tx) => {
        await seedHarness(tx, base, 'gateway-measurements');
        await tx.harnessItems.write.insert(itemOf(base, 1), at);
        await tx.harnessItems.write.insert(itemOf(base, 2), at);
        for (const row of [oldest, newest, sameDayLater, sameDayEarlier, otherItem]) {
          await tx.measurements.write.insert(row);
        }
        return {
          three: await tx.measurements.read.forItem(uid(base + 11), 3),
          all: await tx.measurements.read.forItem(uid(base + 11), 50),
          none: await tx.measurements.read.forItem(uid(base + 13), 50),
        };
      });
      expect(read.three).toEqual([newest, sameDayLater, sameDayEarlier]);
      expect(read.all.map((row) => row.id)).toEqual(
        [newest, sameDayLater, sameDayEarlier, oldest].map((row) => row.id),
      );
      expect(read.none).toEqual([]);
    });
  });
}
