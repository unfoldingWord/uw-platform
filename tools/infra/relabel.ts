import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'smol-toml';

type Table = Record<string, unknown>;
type Migration = { readonly tag: string; readonly deleted_classes?: readonly string[] };

export type ContainerApp = {
  readonly id: string;
  readonly name: string;
  readonly namespaceId: string;
};

type Owner = { readonly worker: string; readonly environment: string };

const ENVIRONMENTS = new Set(['staging', 'production']);

function tableOf(value: unknown, where: string): Table {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} is not a table`);
  }
  return value as Table;
}

function environmentOf(config: Table, environment: string): Table {
  if (!ENVIRONMENTS.has(environment)) throw new Error(`unknown environment ${environment}`);
  return tableOf(tableOf(config['env'], 'env')[environment], `env.${environment}`);
}

function deleteStep(migrations: readonly Migration[], environment: string): number {
  const index = migrations.findIndex((step) => (step.deleted_classes ?? []).length > 0);
  if (index === -1) throw new Error(`env.${environment} has no migration that deletes classes`);
  return index;
}

export function phaseOne(text: string, environment: string): string {
  const config = parse(text) as Table;
  const env = environmentOf(config, environment);
  const migrations = env['migrations'];
  if (!Array.isArray(migrations)) throw new Error(`env.${environment} has no migrations`);
  const steps = migrations as Migration[];
  env['migrations'] = steps.slice(0, deleteStep(steps, environment) + 1);
  delete env['durable_objects'];
  delete env['containers'];
  return stringify(config);
}

export function workerName(text: string, environment: string): string {
  const name = environmentOf(parse(text) as Table, environment)['name'];
  if (typeof name !== 'string') throw new Error(`env.${environment} has no name`);
  return name;
}

function ownedBy(name: string, owner: Owner): boolean {
  const prefix = `${owner.worker}-`;
  const suffix = `-${owner.environment}`;
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return false;
  const className = name.slice(prefix.length, name.length - suffix.length);
  return className !== '' && !className.includes('-');
}

export function orphanedApps(
  apps: readonly ContainerApp[],
  namespaceIds: ReadonlySet<string>,
  owner: Owner,
): readonly ContainerApp[] {
  return apps.filter((app) => ownedBy(app.name, owner) && !namespaceIds.has(app.namespaceId));
}

type Listed = {
  readonly id: string;
  readonly name: string;
  readonly durable_objects?: { readonly namespace_id?: string };
};

function resultOf(file: string): readonly unknown[] {
  const body = JSON.parse(readFileSync(file, 'utf8')) as { result?: unknown };
  if (!Array.isArray(body.result)) throw new Error(`${file} holds no result list`);
  return body.result;
}

function orphanIds(args: readonly string[]): readonly string[] {
  const [environment = '', config = '', namespacesFile = '', appsFile = ''] = args;
  const owner = { worker: workerName(readFileSync(config, 'utf8'), environment), environment };
  const live = new Set((resultOf(namespacesFile) as { readonly id: string }[]).map((n) => n.id));
  const apps = (resultOf(appsFile) as Listed[]).map((app) => ({
    id: app.id,
    name: app.name,
    namespaceId: app.durable_objects?.namespace_id ?? '',
  }));
  return orphanedApps(apps, live, owner).map((app) => app.id);
}

function main(args: readonly string[]): void {
  const [command, ...rest] = args;
  if (command === 'config') {
    const [environment = '', config = ''] = rest;
    writeFileSync(config, phaseOne(readFileSync(config, 'utf8'), environment));
    return;
  }
  if (command === 'orphans') {
    for (const id of orphanIds(rest)) console.log(id);
    return;
  }
  throw new Error(
    'usage: relabel.ts config <env> <wrangler.toml> | orphans <env> <wrangler.toml> <namespaces.json> <apps.json>',
  );
}

if (process.argv[1]?.endsWith('relabel.ts') === true) {
  try {
    main(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
