import { z } from 'zod';
import { googleCall, type GoogleAnswer } from './rest.ts';
import { GOOGLE_SCOPES, type TokenDeps } from './token.ts';

const USERS = 'https://admin.googleapis.com/admin/directory/v1/users';
const HARNESS_TYPE = 'uw-assistant-harness';
const PASSWORD_BYTES = 30;
const directoryScope = [GOOGLE_SCOPES.directoryUser];

const userSchema = z.object({
  id: z.string().min(1).max(100),
  primaryEmail: z.string().min(3).max(254),
  suspended: z.boolean().default(false),
  externalIds: z
    .array(z.object({ customType: z.string().optional(), value: z.string().optional() }))
    .max(50)
    .default([]),
});

export type DirectoryUser = {
  readonly id: string;
  readonly address: string;
  readonly suspended: boolean;
  readonly harnessId: string | null;
};
type DirectoryFailure = 'refused' | 'unavailable' | 'not_wired';
export type DirectoryAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: DirectoryFailure | 'conflict' };

export type NewAssistantUser = {
  readonly address: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly orgUnitPath: string;
  readonly harnessId: string;
};

export type Directory = {
  user(key: string): Promise<DirectoryAnswer<DirectoryUser | null>>;
  insert(user: NewAssistantUser): Promise<DirectoryAnswer<DirectoryUser>>;
  setSuspended(key: string, suspended: boolean): Promise<DirectoryAnswer<null>>;
  remove(key: string): Promise<DirectoryAnswer<null>>;
};

export type DirectoryDeps = { readonly tokens: TokenDeps; readonly adminSubject: string };

function userOf(body: unknown): DirectoryUser | null {
  const parsed = userSchema.safeParse(body);
  if (!parsed.success) return null;
  const marked = parsed.data.externalIds.find((entry) => entry.customType === HARNESS_TYPE);
  return {
    id: parsed.data.id,
    address: parsed.data.primaryEmail.toLowerCase(),
    suspended: parsed.data.suspended,
    harnessId: marked?.value ?? null,
  };
}

function failureOf(answer: Extract<GoogleAnswer, { ok: false }>) {
  if (answer.failure === 'conflict') return { ok: false, failure: 'conflict' } as const;
  const refused = answer.failure === 'refused' || answer.failure === 'gone';
  return { ok: false, failure: refused ? 'refused' : 'unavailable' } as const;
}

export function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PASSWORD_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_');
}

export function newUserBody(user: NewAssistantUser, password: string) {
  return {
    primaryEmail: user.address,
    name: { givenName: user.givenName, familyName: user.familyName },
    password,
    changePasswordAtNextLogin: false,
    orgUnitPath: user.orgUnitPath,
    externalIds: [{ type: 'custom', customType: HARNESS_TYPE, value: user.harnessId }],
  };
}

export function googleDirectory(deps: DirectoryDeps): Directory {
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) =>
    googleCall(deps.tokens, {
      subject: deps.adminSubject,
      scopes: directoryScope,
      method,
      url,
      body,
    });
  const one = (key: string) => `${USERS}/${encodeURIComponent(key)}`;
  return {
    user: async (key) => {
      const answer = await call('GET', one(key));
      if (!answer.ok)
        return answer.failure === 'not_found' ? { ok: true, value: null } : failureOf(answer);
      const user = userOf(answer.body);
      return user === null ? { ok: false, failure: 'unavailable' } : { ok: true, value: user };
    },
    insert: async (user) => {
      const answer = await call('POST', USERS, newUserBody(user, randomPassword()));
      if (!answer.ok) return failureOf(answer);
      const made = userOf(answer.body);
      return made === null ? { ok: false, failure: 'unavailable' } : { ok: true, value: made };
    },
    setSuspended: async (key, suspended) => {
      const answer = await call('PUT', one(key), { suspended });
      return answer.ok ? { ok: true, value: null } : failureOf(answer);
    },
    remove: async (key) => {
      const answer = await call('DELETE', one(key));
      if (answer.ok || answer.failure === 'not_found') return { ok: true, value: null };
      return failureOf(answer);
    },
  };
}
