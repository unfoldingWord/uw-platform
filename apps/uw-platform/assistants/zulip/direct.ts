import { zulipCall, type ZulipIdentity, type ZulipHost, type ZulipOutcome } from './rest.ts';

export type DirectHost = ZulipHost & { readonly bot: ZulipIdentity };
export type DirectSend = {
  readonly toUserId: number;
  readonly content: string;
  readonly timeoutMs: number;
};
export type DirectSent = { readonly messageId: number };

export async function sendDirect(
  host: DirectHost,
  send: DirectSend,
): Promise<ZulipOutcome<DirectSent>> {
  const answer = await zulipCall(host, {
    method: 'POST',
    path: '/api/v1/messages',
    form: { type: 'direct', to: JSON.stringify([send.toUserId]), content: send.content },
    signIn: host.bot,
    timeoutMs: send.timeoutMs,
  });
  if (!answer.ok) return answer;
  const messageId = answer.value['id'];
  return typeof messageId === 'number' && Number.isSafeInteger(messageId) && messageId > 0
    ? { ok: true, value: { messageId } }
    : { ok: false, failure: 'unknown' };
}
