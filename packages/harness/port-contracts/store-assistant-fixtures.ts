import { assistantHarnessKey, harnessSchema, type Harness } from '@uw/contracts';
import type { Store, StoreTransaction } from '../ports.ts';
import { at, uid } from './store-gateway-fixtures.ts';

export type AssistantsSubject = () => { readonly store: Store };

export const assistantsBase = 0x9a00;
export const person = '00000000-0000-4000-8000-000000000001';

export function personalHarness(): Harness {
  return harnessSchema.parse({
    id: uid(assistantsBase),
    key: assistantHarnessKey(person),
    title: 'Assistant',
    template: 'assistant',
    jdArea: '90-99',
    repository: null,
    hostedBuilderEnabled: false,
    paused: false,
    personId: person,
  });
}

export async function ensurePersonal(tx: StoreTransaction): Promise<Harness> {
  const found = await tx.harnesses.read.byPerson(person);
  if (found !== null) return found;
  await tx.harnesses.write.insert(personalHarness(), at);
  return personalHarness();
}
