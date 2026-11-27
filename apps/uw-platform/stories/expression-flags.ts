import {
  storyMayAppear,
  type ExpressionFlag,
  type ExpressionStatus,
  type FlagCounts,
  type RenderChannel,
  type SensitivityLevel,
} from '@uw/contracts';
import { coveredOn, type ConsentHistory } from './consent-interval.ts';

type Told = { readonly channel: RenderChannel; readonly publishedOn: string | null };

export function flagsOf(
  told: Told,
  level: SensitivityLevel,
  consent: ConsentHistory,
): ExpressionFlag[] {
  const flags: ExpressionFlag[] = [];
  if (!storyMayAppear(level, told.channel)) flags.push('told_above_level');
  const outside = told.channel !== 'platform';
  if (outside && told.publishedOn !== null && !coveredOn(consent, told.publishedOn)) {
    flags.push('told_without_consent');
  }
  return flags;
}

type Flagged = { readonly status: ExpressionStatus; readonly flags: readonly ExpressionFlag[] };

export function flagCounts(expressions: readonly Flagged[]): FlagCounts {
  const live = expressions.filter((expression) => expression.status !== 'retired');
  const counted = (flag: ExpressionFlag) =>
    live.filter((expression) => expression.flags.includes(flag)).length;
  return {
    toldAboveLevel: counted('told_above_level'),
    toldWithoutConsent: counted('told_without_consent'),
  };
}
