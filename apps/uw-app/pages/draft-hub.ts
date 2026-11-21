import type { Connection, ConnectionContext, WSMessage } from 'partyserver';
import { YServer } from 'y-partyserver';
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs';
import { systemClock } from '../ports/clock.ts';
import { admittedUntil, savedEverything, stillAdmitted } from './draft-rules.ts';

const STORED = 'doc';
const IDLE_AT = 'idle-at';
const DRAFT_CLOSED = 4001;
const REAUTHORIZE = 4003;
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
    await this.ctx.storage.put(IDLE_AT, systemClock.now().getTime() + IDLE_MS);
    await this.scheduleSweep();
  }

  override async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    const now = systemClock.now().getTime();
    const admitted = admittedUntil(ctx.request.headers.get('x-draft-until'), now);
    if (admitted === null) {
      connection.close(REAUTHORIZE, 'reauthorize');
      return;
    }
    connection.setState(admitted);
    super.onConnect(connection, ctx);
    await this.scheduleSweep();
  }

  override onMessage(connection: Connection, message: WSMessage): void {
    this.sweep();
    if (!stillAdmitted(connection.state, systemClock.now().getTime())) return;
    super.onMessage(connection, message);
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method !== 'POST') return Response.json(this.status());
    const sent = new URL(request.url).searchParams.get('saved');
    if (!savedEverything(this.document, sent)) {
      this.broadcastCustomMessage('saved-behind');
      return Response.json({ ...this.status(), closed: false });
    }
    await this.closeDraft();
    return Response.json({ ...this.status(), closed: true });
  }

  override async onAlarm(): Promise<void> {
    this.sweep();
    if (this.open().length > 0) return this.scheduleSweep();
    const idleAt = (await this.ctx.storage.get<number>(IDLE_AT)) ?? 0;
    if (idleAt <= systemClock.now().getTime()) return this.ctx.storage.deleteAll();
    return this.scheduleSweep();
  }

  private status() {
    return {
      dirty: this.document.getMap('meta').get('dirty') === true,
      editors: this.open().length,
    };
  }

  private open(): Connection[] {
    return [...this.getConnections()];
  }

  private sweep(): void {
    const now = systemClock.now().getTime();
    for (const connection of this.open()) {
      if (!stillAdmitted(connection.state, now)) connection.close(REAUTHORIZE, 'reauthorize');
    }
  }

  private async scheduleSweep(): Promise<void> {
    const untils = this.open().map((connection) => (connection.state as { until: number }).until);
    const idleAt = (await this.ctx.storage.get<number>(IDLE_AT)) ?? Number.POSITIVE_INFINITY;
    const next = Math.min(idleAt, ...untils);
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }

  private async closeDraft(): Promise<void> {
    this.document.getMap('meta').set('dirty', false);
    this.broadcastCustomMessage('saved');
    for (const connection of this.open()) connection.close(DRAFT_CLOSED, 'saved');
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}
