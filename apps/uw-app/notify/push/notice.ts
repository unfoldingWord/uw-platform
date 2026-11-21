import type { PushPayload } from '@uw/contracts';
import type { Logger } from '@uw/core/log';
import type { PushDecision } from '@uw/harness';
import type { PushStore } from './store.ts';
import type { PushTransport } from './transport.ts';

const GONE = new Set([404, 410]);
const URGENT = 3;

export type NoticeSend = {
  readonly store: PushStore;
  readonly transport: PushTransport | null;
  readonly logger: Logger;
};

export type Notice = {
  readonly personId: string;
  readonly payload: PushPayload;
  readonly at: Date;
};

function delivered(status: number | 'failed'): boolean {
  return typeof status === 'number' && status >= 200 && status < 300;
}

async function sendNotice(
  deps: NoticeSend & { readonly transport: PushTransport },
  notice: Notice,
): Promise<PushDecision> {
  const { devices } = await deps.store.devicesOf(notice.personId, notice.at);
  if (devices.length === 0) return 'no_device';
  const answers = await Promise.all(
    devices.map(async (device) => ({
      device,
      status: await deps.transport.send(device, notice.payload, URGENT),
    })),
  );
  const gone = answers.filter(({ status }) => typeof status === 'number' && GONE.has(status));
  await Promise.all(gone.map(({ device }) => deps.store.prune(device.endpoint)));
  return answers.some(({ status }) => delivered(status)) ? 'sent' : 'dropped';
}

export async function pushNotice(deps: NoticeSend, notice: Notice): Promise<PushDecision> {
  const fields = { person_id: notice.personId, reason: notice.payload.reason };
  const { transport } = deps;
  if (transport === null) {
    deps.logger.info('notice not configured', { outcome: 'push_not_configured', ...fields });
    return 'not_configured';
  }
  try {
    const decision = await sendNotice({ ...deps, transport }, notice);
    deps.logger.info('notice pushed', { outcome: `push_${decision}`, ...fields });
    return decision;
  } catch (error) {
    deps.logger.warn('notice failed', {
      outcome: 'push_dropped',
      ...fields,
      error_name: error instanceof Error ? error.name : 'non_error',
    });
    return 'dropped';
  }
}
