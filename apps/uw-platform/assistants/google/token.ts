import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';

export type ServiceAccount = { readonly clientEmail: string; readonly privateKey: string };
export type SubjectKind = 'assistant_mailbox' | 'person' | 'admin';
type SubjectLookup = (email: string) => Promise<SubjectKind | null>;
type CachedToken = { readonly token: string; readonly expiresAt: Date };
export type TokenCache = Map<string, CachedToken>;
export type TokenDeps = {
  readonly account: ServiceAccount;
  readonly fetcher: typeof fetch;
  readonly now: () => Date;
  readonly lookup: SubjectLookup;
  readonly cache: TokenCache;
};
type TokenFailure = 'not_allowed' | 'refused' | 'unavailable' | 'key_invalid';
export type Minted =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly failure: TokenFailure };

const SCOPE_ROOT = 'https://www.googleapis.com/auth/';
export const GOOGLE_SCOPES = {
  gmail: `${SCOPE_ROOT}gmail.modify`,
  calendarEvents: `${SCOPE_ROOT}calendar.events`,
  calendarFreeBusy: `${SCOPE_ROOT}calendar.freebusy`,
  directoryUser: `${SCOPE_ROOT}admin.directory.user`,
} as const;

const allowedScopes: ReadonlyMap<SubjectKind, ReadonlySet<string>> = new Map([
  ['assistant_mailbox', new Set<string>([GOOGLE_SCOPES.gmail])],
  ['person', new Set<string>([GOOGLE_SCOPES.calendarEvents, GOOGLE_SCOPES.calendarFreeBusy])],
  ['admin', new Set<string>([GOOGLE_SCOPES.directoryUser])],
]);

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const PKCS8_HEADER = '-----BEGIN PRIVATE KEY-----';
const ASSERTION_SECONDS = 3600;
const REFRESH_MARGIN_MS = 5 * 60_000;
const TIMEOUT_MS = 5_000;
const REFUSING_STATUSES: ReadonlySet<number> = new Set([400, 401, 403]);

const accountJson = z.object({
  client_email: z.email(),
  private_key: z.string().min(1),
});
const tokenAnswer = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().min(1).max(86_400),
});

export function serviceAccountOf(json: string | undefined): ServiceAccount | null {
  if (json === undefined) return null;
  try {
    const parsed = accountJson.safeParse(JSON.parse(json));
    if (!parsed.success) return null;
    const privateKey = parsed.data.private_key.replaceAll('\\n', '\n');
    return { clientEmail: parsed.data.client_email, privateKey };
  } catch {
    return null;
  }
}

function seconds(at: Date): number {
  return Math.floor(at.getTime() / 1000);
}

async function assertion(deps: TokenDeps, subject: string, scopes: readonly string[]) {
  const { account } = deps;
  if (!account.privateKey.trim().startsWith(PKCS8_HEADER)) return null;
  try {
    const key = await importPKCS8(account.privateKey.trim(), 'RS256');
    const issued = seconds(deps.now());
    return await new SignJWT({ scope: scopes.join(' ') })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(account.clientEmail)
      .setSubject(subject)
      .setAudience(TOKEN_URL)
      .setIssuedAt(issued)
      .setExpirationTime(issued + ASSERTION_SECONDS)
      .sign(key);
  } catch {
    return null;
  }
}

async function exchange(deps: TokenDeps, signed: string): Promise<Minted & { expiresIn?: number }> {
  try {
    const response = await deps.fetcher(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: JWT_BEARER, assertion: signed }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (REFUSING_STATUSES.has(response.status)) return { ok: false, failure: 'refused' };
    const parsed = tokenAnswer.safeParse(await response.json().catch(() => null));
    if (!response.ok || !parsed.success) return { ok: false, failure: 'unavailable' };
    return { ok: true, token: parsed.data.access_token, expiresIn: parsed.data.expires_in };
  } catch {
    return { ok: false, failure: 'unavailable' };
  }
}

async function allowed(deps: TokenDeps, subject: string, scopes: readonly string[]) {
  if (scopes.length === 0) return false;
  const kind = await deps.lookup(subject);
  if (kind === null) return false;
  const allowed = allowedScopes.get(kind);
  return allowed !== undefined && scopes.every((scope) => allowed.has(scope));
}

function cacheKey(deps: TokenDeps, subject: string, scopes: readonly string[]): string {
  return `${deps.account.clientEmail}\n${subject}\n${[...scopes].sort().join(' ')}`;
}

export function forgetToken(deps: TokenDeps, email: string, scopes: readonly string[]): void {
  deps.cache.delete(cacheKey(deps, email.trim().toLowerCase(), scopes));
}

export async function accessToken(
  deps: TokenDeps,
  email: string,
  scopes: readonly string[],
): Promise<Minted> {
  const subject = email.trim().toLowerCase();
  if (!(await allowed(deps, subject, scopes))) return { ok: false, failure: 'not_allowed' };
  const key = cacheKey(deps, subject, scopes);
  const cached = deps.cache.get(key);
  const now = deps.now().getTime();
  if (cached !== undefined && cached.expiresAt.getTime() - now > REFRESH_MARGIN_MS) {
    return { ok: true, token: cached.token };
  }
  const signed = await assertion(deps, subject, scopes);
  if (signed === null) return { ok: false, failure: 'key_invalid' };
  const minted = await exchange(deps, signed);
  if (!minted.ok) return minted;
  const expiresAt = new Date(now + (minted.expiresIn ?? 0) * 1000);
  deps.cache.set(key, { token: minted.token, expiresAt });
  return { ok: true, token: minted.token };
}
