import type { Bindings } from '../env.ts';
import type { ShipGitHub } from '../ports/connectors.ts';

export type PersonDeps = {
  readonly gateGitHub: (env: Bindings, now: () => Date) => ShipGitHub | null;
};

export const noGateGitHub: PersonDeps = { gateGitHub: () => null };
