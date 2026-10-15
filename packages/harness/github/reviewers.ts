import { normalisedIdentifier } from './identifiers.ts';

export type ReviewerIdentity = { readonly login: string; readonly reviewer: string };

export const reviewerIdentities: readonly ReviewerIdentity[] = [
  { login: 'uw-reviewer[bot]', reviewer: 'uw-reviewer' },
  { login: 'uw-reviewer-codex[bot]', reviewer: 'uw-reviewer-codex' },
];

const byLogin: ReadonlyMap<string, string> = new Map(
  reviewerIdentities.map((entry) => [entry.login.toLowerCase(), entry.reviewer]),
);

const asciiLogin = /^[!-~]+$/u;

export function reviewerOf(login: string): string | null {
  const trimmed = login.trim();
  if (!asciiLogin.test(trimmed)) return null;
  return byLogin.get(trimmed.toLowerCase()) ?? null;
}

export const EXTERNAL_PROVIDER = 'external';

export type CountedReviewer = { readonly reviewer: string; readonly external: boolean };

const botSuffix = /\[bot\]$/u;

function externalKey(login: string): string | null {
  return normalisedIdentifier(login.trim().toLowerCase().replace(botSuffix, ''));
}

export function countedReviewer(
  login: string,
  external: readonly string[],
): CountedReviewer | null {
  const own = reviewerOf(login);
  if (own !== null) return { reviewer: own, external: false };
  const folded = login.trim().toLowerCase();
  if (!external.some((entry) => entry.trim().toLowerCase() === folded)) return null;
  const key = externalKey(folded);
  return key === null ? null : { reviewer: key, external: true };
}

export function namesPlatformReviewer(login: string): boolean {
  const key = externalKey(login);
  return reviewerOf(login) !== null || reviewerIdentities.some((entry) => entry.reviewer === key);
}

export function requestsPlatformReviewer(logins: readonly string[]): boolean {
  return logins.some((login) => reviewerOf(login) !== null);
}
