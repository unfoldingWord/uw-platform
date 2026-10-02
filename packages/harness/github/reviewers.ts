export type ReviewerIdentity = { readonly login: string; readonly reviewer: string };

export const reviewerIdentities: readonly ReviewerIdentity[] = [
  { login: 'uw-reviewer[bot]', reviewer: 'uw-reviewer' },
  { login: 'uw-reviewer-codex[bot]', reviewer: 'uw-reviewer-codex' },
];

const byLogin: ReadonlyMap<string, string> = new Map(
  reviewerIdentities.map((entry) => [entry.login.toLowerCase(), entry.reviewer]),
);

export function reviewerOf(login: string): string | null {
  return byLogin.get(login.normalize('NFKC').trim().toLowerCase()) ?? null;
}
