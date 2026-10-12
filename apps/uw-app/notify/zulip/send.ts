import type { Logger } from '@uw/core/log';
import { POSTING_REASONS, type Wake, type ZulipDecision } from '@uw/harness';
import type { NotifyConfig } from '../config.ts';
import { zulipContent } from './message.ts';
import type { ZulipPoster } from './post.ts';

export type ZulipSend = {
  readonly config: NotifyConfig;
  readonly poster: ZulipPoster | null;
  readonly logger: Logger;
};

function fieldsOf(wake: Wake) {
  return { harness_id: wake.harnessId, item_id: wake.itemId, reason: wake.reason };
}

export async function postTo(deps: ZulipSend, wake: Wake): Promise<ZulipDecision> {
  if (!POSTING_REASONS.has(wake.reason)) return 'not_posted';
  const { zulip, appOrigin } = deps.config;
  if (zulip === null || appOrigin === null || deps.poster === null) {
    deps.logger.info('zulip not configured', {
      outcome: 'zulip_not_configured',
      ...fieldsOf(wake),
    });
    return 'not_configured';
  }
  const channel = zulip.channels.get(wake.jdArea);
  if (channel === undefined) {
    deps.logger.warn('zulip channel unmapped', {
      outcome: 'zulip_channel_unmapped',
      ...fieldsOf(wake),
      jd_area: wake.jdArea,
    });
    return 'dropped';
  }
  const posted = await deps.poster.post(channel, wake.topic, zulipContent(wake, appOrigin));
  if (posted === 'posted') {
    deps.logger.info('zulip posted', { outcome: 'zulip_posted', ...fieldsOf(wake) });
    return 'posted';
  }
  deps.logger.warn('zulip dropped', { outcome: 'zulip_dropped', ...fieldsOf(wake) });
  return 'dropped';
}
