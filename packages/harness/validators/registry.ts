import type { ValidationContext, Validator } from './context.ts';
import { learningAttached } from './learning-attached.ts';

export const validatorRegistry: ReadonlyMap<string, Validator> = new Map<string, Validator>([
  ['learning_attached', learningAttached],
]);

export function runValidators(
  keys: readonly string[],
  context: ValidationContext,
): readonly string[] {
  return keys.flatMap((key) => {
    const validator = validatorRegistry.get(key);
    return validator === undefined ? [`unknown_validator: ${key}`] : validator(context);
  });
}
