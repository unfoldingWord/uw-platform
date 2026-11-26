import { assistantHarnessKey, harnessSchema, type JdArea } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { activateTemplate, type Activated } from '../stages/activate.ts';
import { assistantTemplate } from './role.ts';

export type ProvisionInput = {
  readonly harnessId: string;
  readonly personId: string;
  readonly jdArea: JdArea;
};

type ProvisionPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

const { id, personId: personIdSchema, jdArea: jdAreaSchema } = harnessSchema.shape;

function inputRefusal(input: ProvisionInput): Refused | null {
  if (!id.safeParse(input.harnessId).success) {
    return refused('malformed_command', { field: 'harnessId' });
  }
  if (typeof input.personId !== 'string' || !personIdSchema.safeParse(input.personId).success) {
    return refused('malformed_command', { field: 'personId' });
  }
  return jdAreaSchema.safeParse(input.jdArea).success
    ? null
    : refused('malformed_command', { field: 'jdArea' });
}

export async function provision(
  ports: ProvisionPorts,
  caller: Caller,
  input: ProvisionInput,
): Promise<KernelOutcome<Activated>> {
  const malformed = inputRefusal(input);
  if (malformed !== null) return malformed;
  return activateTemplate(ports, caller, {
    harnessId: input.harnessId,
    harnessKey: assistantHarnessKey(input.personId),
    jdArea: input.jdArea,
    template: assistantTemplate,
    repository: null,
    requiredChecks: [],
    personId: input.personId,
  });
}
