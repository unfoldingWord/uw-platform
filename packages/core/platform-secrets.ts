export type StoreSecret = { get(): Promise<string> };

export type SecretSource =
  | 'secrets_store'
  | 'worker_secret'
  | 'worker_secret_after_store_failure'
  | 'store_unreadable'
  | 'not_set';

export type SecretSources = Readonly<Record<string, SecretSource>>;

export type SecretsRead<Name extends string> = {
  readonly values: Readonly<Partial<Record<Name, string>>>;
  readonly sources: Readonly<Record<Name, SecretSource>>;
};

export type SecretBindings<Name extends string> = {
  readonly [Key in Name as `STORE_${Key}`]?: StoreSecret;
};

export type SecretsHealth = {
  readonly status: 'ok' | 'red' | 'not_configured';
  readonly detail: string;
};

type Env = ReadonlyMap<string, unknown>;
type One = { readonly value?: string; readonly source: SecretSource };

const STORE_PREFIX = 'STORE_';
const unread: ReadonlySet<SecretSource> = new Set([
  'worker_secret_after_store_failure',
  'store_unreadable',
]);

export function storeBindingOf<Name extends string>(name: Name): `STORE_${Name}` {
  return `${STORE_PREFIX}${name}`;
}

function isStoreSecret(bound: unknown): bound is StoreSecret {
  return typeof bound === 'object' && bound !== null && 'get' in bound;
}

function workerSecretOf(env: Env, name: string): string | undefined {
  const held = env.get(name);
  return typeof held === 'string' && held !== '' ? held : undefined;
}

async function readOne(env: Env, name: string): Promise<One> {
  const workerSecret = workerSecretOf(env, name);
  const bound = env.get(storeBindingOf(name));
  if (!isStoreSecret(bound)) {
    if (workerSecret === undefined) return { source: 'not_set' };
    return { value: workerSecret, source: 'worker_secret' };
  }
  try {
    return { value: await bound.get(), source: 'secrets_store' };
  } catch {
    if (workerSecret === undefined) return { source: 'store_unreadable' };
    return { value: workerSecret, source: 'worker_secret_after_store_failure' };
  }
}

export async function readPlatformSecrets<Name extends string>(
  env: object,
  names: readonly Name[],
): Promise<SecretsRead<Name>> {
  const bindings: Env = new Map(Object.entries(env));
  const read = await Promise.all(
    names.map(async (name) => [name, await readOne(bindings, name)] as const),
  );
  const values = Object.fromEntries(
    read.flatMap(([name, one]) => (one.value === undefined ? [] : [[name, one.value]])),
  ) as Partial<Record<Name, string>>;
  const sources = Object.fromEntries(read.map(([name, one]) => [name, one.source])) as Record<
    Name,
    SecretSource
  >;
  return { values, sources };
}

export function unreadSecretNames(sources: SecretSources): string[] {
  return Object.entries(sources)
    .filter(([, source]) => unread.has(source))
    .map(([name]) => name)
    .sort();
}

function count(sources: SecretSources, wanted: readonly SecretSource[]): number {
  return Object.values(sources).filter((source) => wanted.includes(source)).length;
}

export function secretsHealth(sources: SecretSources): SecretsHealth {
  const fromStore = count(sources, ['secrets_store']);
  const fromWorker = count(sources, ['worker_secret', 'worker_secret_after_store_failure']);
  const notSet = count(sources, ['not_set']);
  const unreadable = unreadSecretNames(sources).length;
  const counted = `${fromStore} from the Secrets Store, ${fromWorker} from Worker secrets, ${notSet} not set`;
  if (unreadable > 0) {
    return { status: 'red', detail: `${counted}, ${unreadable} unreadable in the Secrets Store` };
  }
  return { status: fromStore + fromWorker === 0 ? 'not_configured' : 'ok', detail: counted };
}

export type SecretReaderOptions = {
  readonly freshMs: number;
  readonly retryMs: number;
  readonly now: () => number;
};

type Held<Name extends string> = {
  readonly at: number;
  readonly reading: Promise<SecretsRead<Name>>;
};

export function secretReader<Name extends string>(
  names: readonly Name[],
  options: SecretReaderOptions,
): (env: object) => Promise<SecretsRead<Name>> {
  const held = new WeakMap<object, Held<Name>>();
  const ages = new WeakMap<Promise<SecretsRead<Name>>, number>();
  return (env) => {
    const at = options.now();
    const kept = held.get(env);
    if (kept !== undefined && at - kept.at < (ages.get(kept.reading) ?? options.freshMs)) {
      return kept.reading;
    }
    const reading = readPlatformSecrets(env, names).then((read) => {
      if (unreadSecretNames(read.sources).length > 0) ages.set(reading, options.retryMs);
      return read;
    });
    held.set(env, { at, reading });
    return reading;
  };
}

export type WithSecrets<Bindings extends object> = Bindings & {
  readonly SECRET_SOURCES: SecretSources;
};

export function workerSecrets<Name extends string>(
  names: readonly Name[],
  options: SecretReaderOptions,
): <Bindings extends object>(
  env: Bindings,
  onUnread: (names: readonly string[]) => void,
) => Promise<WithSecrets<Bindings>> {
  const read = secretReader(names, options);
  const reported = new WeakSet<SecretsRead<Name>>();
  return async (env, onUnread) => {
    const secrets = await read(env);
    const unreadNames = unreadSecretNames(secrets.sources);
    if (unreadNames.length > 0 && !reported.has(secrets)) {
      reported.add(secrets);
      onUnread(unreadNames);
    }
    return { ...env, ...secrets.values, SECRET_SOURCES: secrets.sources };
  };
}
