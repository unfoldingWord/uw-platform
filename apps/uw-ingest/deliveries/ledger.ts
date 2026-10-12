import { and, eq } from 'drizzle-orm';
import type { IngestSource } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { webhookDeliveries } from '@uw/db/schema';
import type { IngestBindings } from '../env.ts';

export const owns = ['webhook_deliveries'] as const;

export type DeliveryLedger = {
  claim(source: IngestSource, deliveryId: string): Promise<boolean>;
  release(source: IngestSource, deliveryId: string): Promise<void>;
};

export type LedgerHandle = { readonly ledger: DeliveryLedger; release(): Promise<void> };

export function postgresLedger(db: Database): DeliveryLedger {
  return {
    claim: async (source, deliveryId) => {
      const rows = await db
        .insert(webhookDeliveries)
        .values({ source, deliveryId })
        .onConflictDoNothing()
        .returning({ deliveryId: webhookDeliveries.deliveryId });
      return rows.length > 0;
    },
    release: async (source, deliveryId) => {
      await db
        .delete(webhookDeliveries)
        .where(
          and(eq(webhookDeliveries.source, source), eq(webhookDeliveries.deliveryId, deliveryId)),
        );
    },
  };
}

export function hyperdriveLedger(env: IngestBindings): LedgerHandle | null {
  if (!env.HYPERDRIVE) return null;
  const db = createClient(env.HYPERDRIVE.connectionString);
  return { ledger: postgresLedger(db), release: () => db.$client.end() };
}
