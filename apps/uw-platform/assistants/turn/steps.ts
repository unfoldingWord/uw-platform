export type Json =
  null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export type TurnStepConfig = { readonly retries: number; readonly timeout: '15 minutes' };

export type AssistantSteps = {
  do<T extends Json>(name: string, config: TurnStepConfig, body: () => Promise<T>): Promise<T>;
};
