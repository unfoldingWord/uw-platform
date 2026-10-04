import './jitless.ts';
import { reconnectingSocket, type LiveTimers } from '../live/session.ts';
import { wireCommandForms } from './command-form.ts';
import { startLive } from './live.ts';
import { morphMain } from './morph.ts';
import { createRefresher } from './refresh.ts';
import { registerWorker } from './register.ts';

const timers: LiveTimers = {
  setInterval: (run, ms) => window.setInterval(run, ms),
  clearInterval: (handle) => window.clearInterval(Number(handle)),
};

document.addEventListener('DOMContentLoaded', () => {
  const send: typeof fetch = (input, init) => window.fetch(input, init);
  const refresher = createRefresher({ document, fetch: send, morph: morphMain });
  void registerWorker(navigator);
  wireCommandForms(document, {
    fetch: send,
    uuid: () => crypto.randomUUID(),
    afterAccepted: () => void refresher.refresh(),
  });
  startLive(document, { fetch: send, connect: reconnectingSocket, timers, refresher });
});
