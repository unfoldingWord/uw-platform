import { z } from 'zod';

export const jdAreaPattern = '^([0-9])0-\\1[9]$';

export const jdAreaSchema = z
  .string()
  .regex(new RegExp(jdAreaPattern), 'a JD area is NN-NN with one decade, for example 80-89');

export type JdArea = z.infer<typeof jdAreaSchema>;

export const jdCategoryPattern = '^[0-9]{2}$';

export const jdCategorySchema = z
  .string()
  .regex(new RegExp(jdCategoryPattern), 'a JD category is two digits, for example 61');

export type JdCategory = z.infer<typeof jdCategorySchema>;

export const jdIdSchema = z
  .string()
  .regex(/^[0-9]{2}\.[0-9]{2}$/, 'a JD ID is NN.NN, for example 01.47');

export function areaOfCategory(category: JdCategory): JdArea {
  const decade = category.charAt(0);
  return `${decade}0-${decade}9`;
}
