export type Json =
  null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export type Duration = '15 minutes' | '30 minutes' | '1 hour';

export type StepConfig = { readonly retries: number; readonly timeout: Duration };

export const STEP: StepConfig = { retries: 3, timeout: '15 minutes' };
export const WORK_STEP: StepConfig = { retries: 3, timeout: '30 minutes' };
export const WAIT_SLICE: Duration = '1 hour';
export const WAIT_SLICES = 720;

export type StepRunner = {
  do<T extends Json>(name: string, config: StepConfig, body: () => Promise<T>): Promise<T>;
  waitForResume(name: string, timeout: Duration): Promise<'resumed' | 'timed_out'>;
};
