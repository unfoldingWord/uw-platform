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
