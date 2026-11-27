import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Database } from '@uw/db/client';
import { measureApp, type MeasureApp } from './measure-app.ts';
import { post } from './commands.ts';
import { createAccessFixture, fixtureAccessEnv, type AccessFixture } from './access-keys.ts';
import { httpClient } from './mcp.ts';
import { postgresDeps } from './postgres.ts';
import { createApp } from '../app.tsx';

type Reply = { readonly status: number; readonly body: Record<string, unknown> };

export type StoryApp = {
  readonly verb: MeasureApp['verb'];
  command(email: string, name: string, body: Record<string, unknown>): Promise<Reply>;
  tools(email: string): Promise<readonly Tool[]>;
};

let fixture: Promise<AccessFixture> | null = null;

function keysOnce(): Promise<AccessFixture> {
  fixture ??= createAccessFixture();
  return fixture;
}

export function storyApp(db: Database): StoryApp {
  const verbs = measureApp(db, {});
  return {
    verb: verbs.verb,
    command: async (email, name, body) => {
      const sent = await post(db, email, `/api/stories/commands/${name}`, {
        command: name,
        requestId: crypto.randomUUID(),
        ...body,
      });
      return { status: sent.status, body: sent.body };
    },
    tools: async (email) => {
      const keys = await keysOnce();
      const token = await keys.signForMcp({ email });
      const app = createApp(postgresDeps(db, keys));
      const headers = { 'cf-access-jwt-assertion': token, 'x-uw-device': 'laptop' };
      const client = await httpClient(app, headers, fixtureAccessEnv);
      try {
        return (await client.listTools()).tools;
      } finally {
        await client.close();
      }
    },
  };
}
