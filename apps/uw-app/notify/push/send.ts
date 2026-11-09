import type { PushPayload } from '@uw/contracts';
import type { Logger } from '@uw/core/log';
import { wakeRank, type PushDecision, type Wake, type WakeRecipient } from '@uw/harness';
import type { PushDevice, PushStore } from './store.ts';
import type { PushTransport } from './transport.ts';

const GONE = new Set([404, 410]);

export type PushSend = {
  readonly store: PushStore;
  readonly transport: PushTransport | null;
  readonly logger: Logger;
};

function payloadOf(wake: Wake): PushPayload {
  return { harness: wake.harnessKey, reason: wake.reason, link: wake.link };
}

function fieldsOf(wake: Wake, recipient: WakeRecipient) {
  return {
    person_id: recipient.personId,
    harness_id: wake.harnessId,
    item_id: wake.itemId,
    reason: wake.reason,
  };
}

async function deliveredCount(
  deps: PushSend & { readonly transport: PushTransport },
  wake: Wake,
  recipient: WakeRecipient,
  devices: readonly PushDevice[],
): Promise<number> {
  const rank = wakeRank[wake.reason];
  const answers = await Promise.all(
    devices.map(async (device) => ({
      device,
      status: await deps.transport.send(device, payloadOf(wake), rank),
    })),
  );
  const gone = answers
    .filter((answer) => typeof answer.status === 'number' && GONE.has(answer.status))
    .map((answer) => answer.device);
  await Promise.all(gone.map((device) => deps.store.prune(device.endpoint)));
  if (gone.length > 0) {
    deps.logger.info('push device pruned', {
      outcome: 'push_pruned',
      ...fieldsOf(wake, recipient),
      pruned_count: gone.length,
    });
  }
  return answers.filter(({ status }) => typeof status === 'number' && status >= 200 && status < 300)
    .length;
}

async function sendTo(
  deps: PushSend & { readonly transport: PushTransport },
  wake: Wake,
  recipient: WakeRecipient,
): Promise<PushDecision> {
  const fields = fieldsOf(wake, recipient);
  const { devices, expired } = await deps.store.devicesOf(recipient.personId, wake.at);
  if (expired > 0) {
    deps.logger.info('push device expired', {
      outcome: 'push_pruned',
      ...fields,
      pruned_count: expired,
    });
  }
  if (devices.length === 0) {
    deps.logger.info('push has no device', { outcome: 'push_no_device', ...fields });
    return 'no_device';
  }
  const claimed = await deps.store.claimWindow(recipient.personId, wakeRank[wake.reason], wake.at);
  if (!claimed) {
    deps.logger.info('push coalesced', { outcome: 'push_coalesced', ...fields });
    return 'coalesced';
  }
  const delivered = await deliveredCount(deps, wake, recipient, devices);
  const counts = { ...fields, device_count: devices.length, delivered_count: delivered };
  if (delivered > 0) {
    deps.logger.info('push sent', { outcome: 'push_sent', ...counts });
    return 'sent';
  }
  deps.logger.warn('push dropped', { outcome: 'push_dropped', ...counts });
  return 'dropped';
}

export async function pushTo(
  deps: PushSend,
  wake: Wake,
  recipient: WakeRecipient,
): Promise<PushDecision> {
  const fields = fieldsOf(wake, recipient);
  if (recipient.present) {
    deps.logger.info('push suppressed', { outcome: 'push_suppressed', ...fields });
    return 'suppressed';
  }
  const transport = deps.transport;
  if (transport === null) {
    deps.logger.info('push not configured', { outcome: 'push_not_configured', ...fields });
    return 'not_configured';
  }
  try {
    return await sendTo({ ...deps, transport }, wake, recipient);
  } catch (error) {
    deps.logger.warn('push failed', {
      outcome: 'push_dropped',
      ...fields,
      error_name: error instanceof Error ? error.name : 'non_error',
    });
    return 'dropped';
  }
}
