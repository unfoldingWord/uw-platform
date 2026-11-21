import './jitless.ts';
import { reconnectingSocket, type LiveTimers } from '../live/session.ts';
import { wireCommandForms } from './command-form.ts';
import { wireDraftEditor } from './draft-editor.ts';
import { startLive } from './live.ts';
import { morphMain } from './morph.ts';
import { wireNavigating } from './navigating.ts';
import { wireNewWorkflow } from './new-workflow.ts';
import { wirePageUpload } from './page-upload.ts';
import { wireEditKey } from './edit-key.ts';
import { wireFavourite } from './favourite.ts';
import { wirePassageComment } from './passage.ts';
import { wirePrint } from './print.ts';
import { browserPush, wirePushControl } from './push-subscribe.ts';
import { wireQuickSwitcher } from './quick-switcher.ts';
import { createRefresher } from './refresh.ts';
import { wireReveal } from './reveal.ts';
import { registerWorker } from './register.ts';

const timers: LiveTimers = {
  setInterval: (run, ms) => window.setInterval(run, ms),
  clearInterval: (handle) => window.clearInterval(Number(handle)),
};

document.addEventListener('DOMContentLoaded', () => {
  const send: typeof fetch = (input, init) => window.fetch(input, init);
  wireNavigating(document);
  const refresher = createRefresher({ document, fetch: send, morph: morphMain });
  void registerWorker(navigator);
  wireCommandForms(document, {
    fetch: send,
    uuid: () => crypto.randomUUID(),
    afterAccepted: () => void refresher.refresh(),
  });
  wireDraftEditor(document, {
    fetch: send,
    uuid: () => crypto.randomUUID(),
    timers: {
      setTimeout: (run, ms) => window.setTimeout(run, ms),
      clearTimeout: (handle) => window.clearTimeout(Number(handle)),
    },
  });
  wireNewWorkflow(document, {
    fetch: send,
    uuid: () => crypto.randomUUID(),
    go: (href) => window.location.assign(href),
  });
  wirePageUpload(document, { fetch: send, uuid: () => crypto.randomUUID() });
  wirePrint(document, () => window.print());
  wireFavourite(document, send);
  wireEditKey(document, (href) => window.location.assign(href));
  wirePassageComment(document, {
    selected: () => {
      const selection = window.getSelection();
      return { text: selection?.toString() ?? '', inside: selection?.anchorNode ?? null };
    },
    go: (href) => window.location.assign(href),
  });
  wireQuickSwitcher(document, {
    fetch: send,
    go: (href) => window.location.assign(href),
    openTab: (href) => void window.open(href, '_blank', 'noopener'),
  });
  wireReveal(document, {
    fetch: send,
    uuid: () => crypto.randomUUID(),
    timers: {
      setTimeout: (run, ms) => window.setTimeout(run, ms),
      clearTimeout: (handle) => window.clearTimeout(Number(handle)),
    },
  });
  startLive(document, { fetch: send, connect: reconnectingSocket, timers, refresher });
  wirePushControl(document, { fetch: send, push: browserPush(navigator) });
});
