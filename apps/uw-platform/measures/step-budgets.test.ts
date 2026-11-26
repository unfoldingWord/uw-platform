import { describe, expect, it } from 'vitest';
import {
  INSTALL_WORST_MS,
  MEASURE_TIMEOUT_MS,
  RESOURCE_WORST_MS,
  SANDBOX_LIMITS,
} from './sandbox.ts';
import { STEP_BUDGETS } from './step-budgets.ts';

const { startMs, lockMs, installMs, graceMs } = SANDBOX_LIMITS;

describe('the time each step of a measure run may take', () => {
  it('counts the container start, every runner limit and its grace in the worst cases', () => {
    expect(INSTALL_WORST_MS).toBe(startMs + lockMs + graceMs + installMs + graceMs);
    expect(RESOURCE_WORST_MS).toBe(startMs + installMs + graceMs + MEASURE_TIMEOUT_MS + graceMs);
  });

  it('gives a sandbox step longer than the worst case of the install or of one resource', () => {
    expect(STEP_BUDGETS.sandbox.timeout).toBeGreaterThan(INSTALL_WORST_MS);
    expect(STEP_BUDGETS.sandbox.timeout).toBeGreaterThan(RESOURCE_WORST_MS);
  });

  it('retries a sandbox step long enough for a busy container pool to free a place', () => {
    const { limit, delay, backoff } = STEP_BUDGETS.sandbox.retries;
    expect(backoff).toBe('exponential');
    const waited = Array.from({ length: limit }, (_, tried) => delay * 2 ** tried);
    expect(waited.reduce((sum, each) => sum + each, 0)).toBeGreaterThan(RESOURCE_WORST_MS);
  });

  it('keeps the database steps short, with retries of their own', () => {
    expect(STEP_BUDGETS.record.timeout).toBeLessThan(STEP_BUDGETS.sandbox.timeout);
    expect(STEP_BUDGETS.record.retries.limit).toBeGreaterThanOrEqual(2);
  });
});
