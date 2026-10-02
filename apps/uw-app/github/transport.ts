export type GitHubTransport = { readonly fetch: typeof fetch; readonly now: () => Date };

export function platformGitHubTransport(now: () => Date): GitHubTransport {
  return { fetch: fetch.bind(globalThis), now };
}
