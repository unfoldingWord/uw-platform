import { assistantDirectEffectSchema } from '@uw/contracts';

export type EffectClass = 'direct' | 'proposal';

export function classifyEffect(kind: string): EffectClass {
  return assistantDirectEffectSchema.safeParse(kind).success ? 'direct' : 'proposal';
}
