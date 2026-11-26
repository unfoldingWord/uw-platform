import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { AssistantSettingsRow, Ports } from '../ports.ts';
import type { Activated } from '../stages/activate.ts';
import { finishTurn, type FinishInput, type Finished } from './finish.ts';
import { provision, type ProvisionInput } from './provision.ts';
import { recordRequest, type RecordedRequest, type RequestInput } from './requests.ts';
import { customise, type CustomiseInput } from './settings.ts';
import { beginTurn, type BeginInput, type Turn } from './turn.ts';

export type AssistantCommands = {
  provision(caller: Caller, input: ProvisionInput): Promise<KernelOutcome<Activated>>;
  customise(caller: Caller, input: CustomiseInput): Promise<KernelOutcome<AssistantSettingsRow>>;
  recordRequest(caller: Caller, input: RequestInput): Promise<KernelOutcome<RecordedRequest>>;
  beginTurn(caller: Caller, input: BeginInput): Promise<KernelOutcome<Turn>>;
  finishTurn(caller: Caller, input: FinishInput): Promise<KernelOutcome<Finished>>;
};

type AssistantPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store' | 'directMessages'>;

export function createAssistantCommands(ports: AssistantPorts): AssistantCommands {
  return {
    provision: (caller, input) => provision(ports, caller, input),
    customise: (caller, input) => customise(ports, caller, input),
    recordRequest: (caller, input) => recordRequest(ports, caller, input),
    beginTurn: (caller, input) => beginTurn(ports, caller, input),
    finishTurn: (caller, input) => finishTurn(ports, caller, input),
  };
}
