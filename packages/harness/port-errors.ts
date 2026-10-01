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

export function notWiredCall(port: PortName, method: string): Promise<never> {
  return Promise.reject(new PortNotWiredError(port, method));
}
