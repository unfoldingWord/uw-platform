import {
  storyMayAppear,
  type ExpressionFlag,
  type ExpressionStatus,
  type FlagCounts,
  type RenderChannel,
  type SensitivityLevel,
} from '@uw/contracts';

export type ConsentFacts = {
  readonly consentedOn: string;
  readonly expires: string | null;
  readonly withdrawnOn: string | null;
} | null;

type Told = { readonly channel: RenderChannel; readonly publishedOn: string | null };

function coveredOn(consent: ConsentFacts, day: string): boolean {
  if (consent === null || consent.consentedOn > day) return false;
  if (consent.expires !== null && consent.expires < day) return false;
  return consent.withdrawnOn === null || consent.withdrawnOn > day;
}

export function flagsOf(
  told: Told,
  level: SensitivityLevel,
  consent: ConsentFacts,
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
