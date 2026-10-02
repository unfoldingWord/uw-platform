import { failed } from './failures.ts';

const fullSha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

const branch = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,254}$/;

export function isBranch(value: string): boolean {
  return branch.test(value) && !value.includes('..');
}

export function isFullSha(value: string): boolean {
  return fullSha.test(value);
}

export const refusedInput = failed('unprocessable', null);
