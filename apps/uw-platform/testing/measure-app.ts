import type { Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import type { Bindings } from '../env.ts';
import { createAccessFixture, fixtureAccessEnv, type AccessFixture } from './access-keys.ts';
import { callTool, httpClient } from './mcp.ts';
import { postgresDeps } from './postgres.ts';

type Reply = { readonly status: number; readonly body: Record<string, unknown> };
type Called = { readonly isError: boolean; readonly body: Record<string, unknown> };

export type MeasureApp = {
  verb(email: string, name: string, args: Record<string, unknown>): Promise<Called>;
  command(email: string, name: string, body: Record<string, unknown>): Promise<Reply>;
};

let fixture: Promise<AccessFixture> | null = null;

function keysOnce(): Promise<AccessFixture> {
  fixture ??= createAccessFixture();
  return fixture;
}

export function measureApp(db: Database, bindings: Partial<Bindings>): MeasureApp {
  const env: Bindings = { ...fixtureAccessEnv, ...bindings };
  return {
    verb: async (email, name, args) => {
      const keys = await keysOnce();
      const token = await keys.signForMcp({ email });
      const app = createApp(postgresDeps(db, keys));
      const headers = { 'cf-access-jwt-assertion': token, 'x-uw-device': 'laptop' };
      const client = await httpClient(app, headers, env);
      try {
        return await callTool(client, name, args);
      } finally {
        await client.close();
      }
    },
    command: async (email, name, body) => {
      const keys = await keysOnce();
      const token = await keys.sign({ email });
      const response = await createApp(postgresDeps(db, keys)).request(
        `/api/measures/commands/${name}`,
        {
          method: 'POST',
          body: JSON.stringify({ command: name, requestId: crypto.randomUUID(), ...body }),
          headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' },
        },
        env,
      );
      const parsed: unknown = JSON.parse(await response.text());
      const record = typeof parsed === 'object' && parsed !== null ? parsed : {};
      return { status: response.status, body: Object.fromEntries(Object.entries(record)) };
    },
  };
}
