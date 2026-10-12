export type Timers = { after(ms: number, signal: AbortSignal): Promise<void> };

export const systemTimers: Timers = {
  after: (ms, signal) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    }),
};
