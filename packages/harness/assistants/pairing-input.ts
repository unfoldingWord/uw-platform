import { assistantChannelSchema, type AssistantChannel } from '@uw/contracts';
import { refused, type Refused } from '../outcome.ts';

const DIGEST = /^[0-9a-f]{64}$/;
const ZULIP_ADDRESS = /^zulip:[1-9][0-9]{0,14}$/;
const EMAIL_ADDRESS = /^[^\s@]{1,64}@[^\s@]{1,189}$/;

export function digestRefusal(codeDigest: string): Refused | null {
  return DIGEST.test(codeDigest) ? null : refused('malformed_command', { why: 'code_digest' });
}

type Addressed = { readonly channel: AssistantChannel; readonly address: string };

export function addressRefusal(input: Addressed): Refused | null {
  const channel = assistantChannelSchema.safeParse(input.channel);
  if (!channel.success) return refused('malformed_command', { why: 'channel' });
  const shape = channel.data === 'zulip_dm' ? ZULIP_ADDRESS : EMAIL_ADDRESS;
  return shape.test(input.address) ? null : refused('malformed_command', { why: 'address' });
}
