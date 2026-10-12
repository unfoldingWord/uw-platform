import { DEFAULT_SPEND_CAP } from '@uw/harness';

const POSITIVE_INTEGER = /^[1-9]\d{0,14}$/;

export type SpendCap = { readonly capMinor: number; readonly currency: 'USD' };

export function spendCapOf(settings: {
  readonly AI_SPEND_CAP_MINOR?: string | undefined;
}): SpendCap {
  const configured = settings.AI_SPEND_CAP_MINOR ?? '';
  if (!POSITIVE_INTEGER.test(configured)) return DEFAULT_SPEND_CAP;
  return { capMinor: Number(configured), currency: 'USD' };
}
