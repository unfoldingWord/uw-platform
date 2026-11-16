import {
  agentPickupSchema,
  connectorSchema,
  exitGateSchema,
  stageBracketSchema,
  type AgentPickup,
  type Connector,
  type ExitGate,
} from '@uw/contracts';
import { bracketText } from './flow-diagram.tsx';

export type Choice = { readonly value: string; readonly label: string };

const exitWords: ReadonlyMap<ExitGate, string> = new Map([
  ['none', 'Moves on by itself'],
  ['checks', 'Checks pass'],
  ['human_approval', 'A person approves'],
]);

const pickupWords: ReadonlyMap<AgentPickup, string> = new Map([
  ['none', 'People only'],
  ['allowed', 'Agents may pick up'],
  ['auto', 'Agents pick up at once'],
]);

const connectorWords: ReadonlyMap<Connector, string> = new Map([
  ['none', 'No action'],
  ['merge', 'Merge'],
  ['deploy', 'Deploy'],
  ['publish', 'Publish'],
  ['send', 'Send'],
  ['post', 'Post'],
]);

export const draftChoices = {
  bracket: stageBracketSchema.options.map((value) => ({ value, label: bracketText(value) })),
  exitGate: exitGateSchema.options.map((value) => ({
    value,
    label: exitWords.get(value) ?? value,
  })),
  agentPickup: agentPickupSchema.options.map((value) => ({
    value,
    label: pickupWords.get(value) ?? value,
  })),
  connector: connectorSchema.options.map((value) => ({
    value,
    label: connectorWords.get(value) ?? value,
  })),
} as const satisfies Record<string, readonly Choice[]>;

export const cleanCheck =
  '✓ Checked: every path reaches an end, and a person approves before any merge.';

export function problemCount(count: number): string {
  return count === 1
    ? '1 problem to fix before publishing.'
    : `${count} problems to fix before publishing.`;
}
