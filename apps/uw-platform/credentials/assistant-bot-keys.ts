import { utf8 } from './base64.ts';
import type { DataKeys } from './data-keys.ts';
import { openValue, sealValue, type SealedValue } from './envelope.ts';

export type SealedBotKey = SealedValue;

export type BotKeyOwner = { readonly harnessId: string; readonly botUserId: number };

function contextOf(owner: BotKeyOwner) {
  return { assistantHarnessId: owner.harnessId, botUserId: owner.botUserId };
}

export async function sealBotKey(
  keys: DataKeys,
  owner: BotKeyOwner,
  apiKey: string,
): Promise<SealedBotKey | null> {
  const sealed = await sealValue(keys, contextOf(owner), utf8(apiKey));
  return sealed.ok ? sealed.sealed : null;
}

export async function openBotKey(
  keys: DataKeys,
  owner: BotKeyOwner,
  sealed: SealedBotKey,
): Promise<string | null> {
  const opened = await openValue(keys, contextOf(owner), sealed);
  if (!opened.ok) return null;
  try {
    return new TextDecoder().decode(opened.plaintext);
  } finally {
    opened.plaintext.fill(0);
  }
}
