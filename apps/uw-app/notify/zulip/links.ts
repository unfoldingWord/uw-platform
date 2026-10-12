import type { JdArea } from '@uw/contracts';
import type { ZulipConfig } from './config.ts';

function hash(value: string): string {
  return encodeURIComponent(value).replace(/\./g, '%2E').replace(/%/g, '.');
}

export function zulipTopicUrl(site: string, channel: string, topic: string): string {
  return `${site}/#narrow/channel/${hash(channel)}/topic/${hash(topic)}`;
}

export function itemTopicUrl(
  config: ZulipConfig | null,
  jdArea: JdArea,
  topic: string | null,
): string | null {
  const channel = config?.channels.get(jdArea);
  if (config === null || channel === undefined || topic === null) return null;
  return zulipTopicUrl(config.site, channel, topic);
}
