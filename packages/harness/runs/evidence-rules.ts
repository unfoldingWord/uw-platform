import { eventEvidenceSchemas } from '@uw/contracts';

const failureDetail = eventEvidenceSchemas.run_failed.shape.detail;
const premiseReason = eventEvidenceSchemas.premise_held.shape.reason;

export function isFailureDetail(value: string): boolean {
  return failureDetail.safeParse(value).success;
}

export function isPremiseReason(value: string): boolean {
  return premiseReason.safeParse(value).success;
}
