import { failed } from './failures.ts';

const fullSha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function isFullSha(value: string): boolean {
  return fullSha.test(value);
}

export const refusedInput = failed('unprocessable', null);
