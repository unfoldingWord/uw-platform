import type { PortName, RunAction, RunState } from './ports.ts';

export class PortNotWiredError extends Error {
  readonly port: PortName;
  readonly method: string;

  constructor(port: PortName, method: string) {
    super(`${port}.${method} is not wired`);
    this.name = 'PortNotWiredError';
    this.port = port;
    this.method = method;
  }
}

export class FactsUnavailableError extends Error {
  readonly failure: string;

  constructor(failure: string) {
    super(`the GitHub facts could not be read again: ${failure}`);
    this.name = 'FactsUnavailableError';
    this.failure = failure;
  }
}

export class RunTransitionError extends Error {
  readonly runId: string;
  readonly from: RunState | null;
  readonly action: RunAction;

  constructor(runId: string, from: RunState | null, action: RunAction) {
    super(`cannot ${action} run ${runId} from ${from ?? 'nothing'}`);
    this.name = 'RunTransitionError';
    this.runId = runId;
    this.from = from;
    this.action = action;
  }
}

export class ToolOutsideToolsetError extends Error {
  readonly verb: string;

  constructor(verb: string) {
    super(`the turn called ${verb}, which is outside the offered toolset`);
    this.name = 'ToolOutsideToolsetError';
    this.verb = verb;
  }
}

export class ProviderMismatchError extends Error {
  readonly pinned: string;
  readonly resolved: string | null;

  constructor(pinned: string, resolved: string | null) {
    super(
      `the run pins provider ${pinned}, but the turn was served by ${resolved ?? 'no provider'}`,
    );
    this.name = 'ProviderMismatchError';
    this.pinned = pinned;
    this.resolved = resolved;
  }
}

export function notWiredCall(port: PortName, method: string): Promise<never> {
  return Promise.reject(new PortNotWiredError(port, method));
}

export type StoreRefusal = {
  readonly code: string;
  readonly constraint: string | null;
  readonly table: string | null;
};

function textOrNull(error: Error, key: string): string | null {
  const value: unknown = Reflect.get(error, key);
  return typeof value === 'string' ? value : null;
}

export function storeRefusalOf(error: unknown): StoreRefusal | null {
  if (!(error instanceof Error) || error.name !== 'StoreRefusedError') return null;
  const code = textOrNull(error, 'code');
  if (code === null) return null;
  return { code, constraint: textOrNull(error, 'constraint'), table: textOrNull(error, 'table') };
}
