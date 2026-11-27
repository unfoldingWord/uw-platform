import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { KernelSettings } from '../kernel-settings.ts';
import type { AssistantSettingsRow, Ports } from '../ports.ts';
import type { Activated } from '../stages/activate.ts';
import { setBudget, type BudgetSet, type SetBudgetInput } from './budget.ts';
import { finishTurn, type FinishInput, type Finished } from './finish.ts';
import {
  bindAddress,
  completePairing,
  startPairing,
  type BindAddressInput,
  type CompletePairingInput,
  type Paired,
  type StartedPairing,
  type StartPairingInput,
} from './pairing.ts';
import { provision, type ProvisionInput } from './provision.ts';
import { enable, type EnableInput, type Enabled } from './accounts.ts';
import {
  disable,
  recordProvisioning,
  retire,
  type Disabled,
  type ProvisioningRecord,
  type RetireInput,
  type Retired,
} from './account-lifecycle.ts';
import {
  activateAssistantPersona,
  type AssistantActivationInput,
} from '../personas/assistant-activation.ts';
import type { ActivatedPersona } from '../personas/types.ts';
import {
  cancelReminder,
  setReminder,
  type CancelReminderInput,
  type DraftedEffect,
  type SetReminderInput,
} from './reminder-drafts.ts';
import {
  findFreeTime,
  readMyCalendar,
  type CalendarRead,
  type FindTimeInput,
  type FreeTime,
  type ReadCalendarInput,
} from './calendar-reads.ts';
import {
  holdTime,
  releaseHold,
  type HoldTimeInput,
  type ReleaseHoldInput,
} from './calendar-drafts.ts';
import { fireDueReminders, type FireInput, type Fired } from './reminder-fire.ts';
import type { TurnAddress } from './reminder-turn.ts';
import { listReminders, type ListedReminders } from './reminders.ts';
import { recordRequest, type RecordedRequest, type RequestInput } from './requests.ts';
import { customise, type CustomiseInput } from './settings.ts';
import { closeStaleTurns, type SweepInput, type Swept } from './stale.ts';
import { unstartedRequests, type Unstarted, type UnstartedInput } from './unstarted.ts';
import { beginTurn, type BeginInput, type Turn } from './turn.ts';

export type AssistantCommands = {
  provision(caller: Caller, input: ProvisionInput): Promise<KernelOutcome<Activated>>;
  enable(caller: Caller, input: EnableInput): Promise<KernelOutcome<Enabled>>;
  disable(caller: Caller, input: Record<string, never>): Promise<KernelOutcome<Disabled>>;
  retire(caller: Caller, input: RetireInput): Promise<KernelOutcome<Retired>>;
  recordProvisioning(caller: Caller, input: ProvisioningRecord): Promise<KernelOutcome<null>>;
  activatePersona(
    caller: Caller,
    input: AssistantActivationInput,
  ): Promise<KernelOutcome<ActivatedPersona>>;
  customise(caller: Caller, input: CustomiseInput): Promise<KernelOutcome<AssistantSettingsRow>>;
  recordRequest(caller: Caller, input: RequestInput): Promise<KernelOutcome<RecordedRequest>>;
  beginTurn(caller: Caller, input: BeginInput): Promise<KernelOutcome<Turn>>;
  finishTurn(caller: Caller, input: FinishInput): Promise<KernelOutcome<Finished>>;
  setReminder(caller: Caller, input: SetReminderInput): Promise<KernelOutcome<DraftedEffect>>;
  cancelReminder(caller: Caller, input: CancelReminderInput): Promise<KernelOutcome<DraftedEffect>>;
  listReminders(caller: Caller, input: TurnAddress): Promise<KernelOutcome<ListedReminders>>;
  fireDueReminders(caller: Caller, input: FireInput): Promise<KernelOutcome<Fired>>;
  readMyCalendar(caller: Caller, input: ReadCalendarInput): Promise<KernelOutcome<CalendarRead>>;
  findFreeTime(caller: Caller, input: FindTimeInput): Promise<KernelOutcome<FreeTime>>;
  holdTime(caller: Caller, input: HoldTimeInput): Promise<KernelOutcome<DraftedEffect>>;
  releaseHold(caller: Caller, input: ReleaseHoldInput): Promise<KernelOutcome<DraftedEffect>>;
  startPairing(caller: Caller, input: StartPairingInput): Promise<KernelOutcome<StartedPairing>>;
  completePairing(caller: Caller, input: CompletePairingInput): Promise<KernelOutcome<Paired>>;
  bindAddress(caller: Caller, input: BindAddressInput): Promise<KernelOutcome<Paired>>;
  setBudget(caller: Caller, input: SetBudgetInput): Promise<KernelOutcome<BudgetSet>>;
  closeStaleTurns(caller: Caller, input: SweepInput): Promise<KernelOutcome<Swept>>;
  unstartedRequests(caller: Caller, input: UnstartedInput): Promise<KernelOutcome<Unstarted>>;
};

type AssistantPorts = Pick<
  Ports,
  'clock' | 'grants' | 'ids' | 'store' | 'directMessages' | 'workspace'
>;

export function createAssistantCommands(
  ports: AssistantPorts,
  settings: KernelSettings,
): AssistantCommands {
  return {
    provision: (caller, input) => provision(ports, settings, caller, input),
    enable: (caller, input) => enable(ports, settings, caller, input),
    disable: (caller) => disable(ports, caller),
    retire: (caller, input) => retire(ports, caller, input),
    recordProvisioning: (caller, input) => recordProvisioning(ports, caller, input),
    activatePersona: (caller, input) => activateAssistantPersona(ports, caller, input),
    customise: (caller, input) => customise(ports, caller, input),
    recordRequest: (caller, input) => recordRequest(ports, caller, input),
    beginTurn: (caller, input) => beginTurn(ports, settings, caller, input),
    finishTurn: (caller, input) => finishTurn(ports, caller, input),
    setReminder: (caller, input) => setReminder(ports, caller, input),
    cancelReminder: (caller, input) => cancelReminder(ports, caller, input),
    listReminders: (caller, input) => listReminders(ports, caller, input),
    fireDueReminders: (caller, input) => fireDueReminders(ports, caller, input),
    readMyCalendar: (caller, input) => readMyCalendar(ports, caller, input),
    findFreeTime: (caller, input) => findFreeTime(ports, caller, input),
    holdTime: (caller, input) => holdTime(ports, caller, input),
    releaseHold: (caller, input) => releaseHold(ports, caller, input),
    startPairing: (caller, input) => startPairing(ports, caller, input),
    completePairing: (caller, input) => completePairing(ports, caller, input),
    bindAddress: (caller, input) => bindAddress(ports, caller, input),
    setBudget: (caller, input) => setBudget(ports, caller, input),
    closeStaleTurns: (caller, input) => closeStaleTurns(ports, caller, input),
    unstartedRequests: (caller, input) => unstartedRequests(ports, caller, input),
  };
}
