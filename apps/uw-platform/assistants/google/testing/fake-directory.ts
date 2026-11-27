type Reply = { readonly status: number; readonly body: unknown };
type Issued = { readonly subject: string; readonly scopes: readonly string[] };

type FakeDirectoryUser = {
  id: string;
  primaryEmail: string;
  aliases: string[];
  suspended: boolean;
  orgUnitPath: string;
  name: { givenName: string; familyName: string };
  externalIds: { type: string; customType?: string; value: string }[];
  passwordSet: boolean;
};

export type FakeDirectory = {
  route(method: string, path: string, issued: Issued, body: unknown): Reply | null;
  add(address: string, aliases?: readonly string[]): void;
  user(address: string): FakeDirectoryUser | null;
};

const USERS_PATH = '/admin/directory/v1/users';
const DIRECTORY_SCOPE = 'https://www.googleapis.com/auth/admin.directory.user';

function error(status: number, message: string): Reply {
  return { status, body: { error: { code: status, message } } };
}

function shown(user: FakeDirectoryUser) {
  const { id, primaryEmail, aliases, suspended, orgUnitPath, name, externalIds } = user;
  const fields = { id, primaryEmail, aliases, suspended, orgUnitPath, name, externalIds };
  return { kind: 'admin#directory#user', ...fields };
}

type Store = {
  readonly users: FakeDirectoryUser[];
  readonly onCreate: (address: string) => void;
  next: number;
};

function find(store: Store, key: string): FakeDirectoryUser | null {
  const matches = (user: FakeDirectoryUser) =>
    user.id === key || user.primaryEmail === key || user.aliases.includes(key);
  return store.users.find(matches) ?? null;
}

function make(
  store: Store,
  address: string,
  aliases: readonly string[],
  body: Partial<FakeDirectoryUser>,
): FakeDirectoryUser {
  store.next += 1;
  const user: FakeDirectoryUser = {
    id: `10${String(store.next).padStart(19, '0')}`,
    primaryEmail: address,
    aliases: [...aliases],
    suspended: false,
    orgUnitPath: body.orgUnitPath ?? '/',
    name: body.name ?? { givenName: 'Seeded', familyName: 'User' },
    externalIds: body.externalIds ?? [],
    passwordSet: body.passwordSet ?? true,
  };
  store.users.push(user);
  store.onCreate(address);
  return user;
}

function insert(store: Store, body: unknown): Reply {
  const asked = body as Partial<FakeDirectoryUser> & { password?: string };
  const address = String(asked.primaryEmail ?? '').toLowerCase();
  if (find(store, address) !== null) return error(409, 'Entity already exists.');
  if ((asked.password ?? '').length < 8) return error(400, 'Invalid Password');
  return { status: 200, body: shown(make(store, address, [], { ...asked, passwordSet: true })) };
}

function one(store: Store, method: string, key: string, body: unknown): Reply {
  const user = find(store, key);
  if (user === null) return error(404, 'Resource Not Found: userKey');
  if (method === 'GET') return { status: 200, body: shown(user) };
  if (method === 'PUT') {
    const change = body as { suspended?: boolean };
    if (typeof change.suspended === 'boolean') user.suspended = change.suspended;
    return { status: 200, body: shown(user) };
  }
  if (method !== 'DELETE') return error(404, 'Not Found');
  store.users.splice(store.users.indexOf(user), 1);
  return { status: 204, body: null };
}

export function createFakeDirectory(onCreate: (address: string) => void): FakeDirectory {
  const store: Store = { users: [], onCreate, next: 0 };
  return {
    route: (method, path, issued, body) => {
      if (!path.startsWith(USERS_PATH)) return null;
      if (!issued.scopes.includes(DIRECTORY_SCOPE)) return error(403, 'Not Authorized');
      if (path === USERS_PATH)
        return method === 'POST' ? insert(store, body) : error(404, 'Not Found');
      return one(store, method, decodeURIComponent(path.slice(USERS_PATH.length + 1)), body);
    },
    add: (address, aliases = []) => {
      make(store, address, aliases, {});
    },
    user: (address) => find(store, address),
  };
}
