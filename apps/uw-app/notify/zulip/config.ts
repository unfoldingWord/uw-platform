import { z } from 'zod';
import { jdAreaSchema, type JdArea } from '@uw/contracts';
import type { Bindings } from '../../env.ts';
import { httpsOrigin } from '../origin.ts';

export type ZulipConfig = {
  readonly site: string;
  readonly botEmail: string;
  readonly apiKey: string;
  readonly channels: ReadonlyMap<JdArea, string>;
};

const channelsSchema = z.record(jdAreaSchema, z.string().min(1).max(60));
const emailSchema = z.email();

function channelsOf(text: string | undefined): ReadonlyMap<JdArea, string> | null {
  if (text === undefined) return null;
  try {
    const parsed = channelsSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    return new Map(
      Object.entries(parsed.data).flatMap(([key, channel]) => {
        const area = jdAreaSchema.safeParse(key);
        return area.success ? [[area.data, channel] as const] : [];
      }),
    );
  } catch {
    return null;
  }
}

export function zulipConfigOf(env: Bindings): ZulipConfig | null {
  const site = httpsOrigin(env.ZULIP_SITE);
  const botEmail = emailSchema.safeParse(env.ZULIP_BOT_EMAIL);
  const apiKey = env.ZULIP_BOT_API_KEY ?? '';
  const channels = channelsOf(env.ZULIP_CHANNELS);
  if (site === null || !botEmail.success || channels === null) return null;
  if (apiKey.length < 1 || apiKey.length > 200) return null;
  return { site, botEmail: botEmail.data, apiKey, channels };
}
