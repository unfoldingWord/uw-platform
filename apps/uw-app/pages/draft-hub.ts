import { YServer } from 'y-partyserver';
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs';
import { systemClock } from '../ports/clock.ts';

const STORED = 'doc';
const DRAFT_CLOSED = 4001;
const IDLE_MS = 30 * 24 * 60 * 60 * 1000;

export class PageDraft extends YServer {
  static override callbackOptions = { debounceWait: 1000, debounceMaxWait: 5000 };

  override async onLoad(): Promise<Doc | undefined> {
    const stored = await this.ctx.storage.get<Uint8Array>(STORED);
    if (stored === undefined) return undefined;
    const doc = new Doc();
    applyUpdate(doc, stored);
    return doc;
  }

  override async onSave(): Promise<void> {
    await this.ctx.storage.put(STORED, encodeStateAsUpdate(this.document));
    await this.ctx.storage.setAlarm(systemClock.now().getTime() + IDLE_MS);
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === 'POST') await this.closeDraft();
    return Response.json({
      dirty: this.document.getMap('meta').get('dirty') === true,
      editors: [...this.getConnections()].length,
    });
  }

  override async onAlarm(): Promise<void> {
    if ([...this.getConnections()].length > 0) return;
    await this.ctx.storage.deleteAll();
  }

  private async closeDraft(): Promise<void> {
    this.document.getMap('meta').set('dirty', false);
    this.broadcastCustomMessage('saved');
    for (const connection of this.getConnections()) connection.close(DRAFT_CLOSED, 'saved');
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}
