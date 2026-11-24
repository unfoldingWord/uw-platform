import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import {
  addPropertyCommandSchema,
  changePropertyTypeCommandSchema,
  createCollectionCommandSchema,
  createRowCommandSchema,
  deleteViewCommandSchema,
  moveCardCommandSchema,
  removePropertyCommandSchema,
  saveTemplateCommandSchema,
  saveViewCommandSchema,
  setPropertyCommandSchema,
  updateCollectionCommandSchema,
  updatePropertyCommandSchema,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson } from '../http/commands.ts';
import { refuse } from '../http/outcomes.ts';
import { collectionsScreen } from '../views/screens/collections.tsx';
import { collectionScreen, collectionViewScreen } from '../views/screens/collection.tsx';
import { collectionSettingsScreen } from '../views/screens/collection-settings.tsx';
import { rowScreen } from '../views/screens/collection-row.tsx';
import {
  addProperty,
  changePropertyType,
  createCollection,
  removeProperty,
  updateCollection,
  updateProperty,
  type Request,
} from './definition-commands.ts';
import { exportView, listCollections, readCollection, readViewRows } from './read-handlers.ts';
import type { CollectionOutcome } from './outcome.ts';
import { createRow, setProperty } from './rows.ts';
import { deleteView, moveCard, saveTemplate, saveView } from './view-commands.ts';

type Run = (db: Database, body: never, request: Request) => Promise<CollectionOutcome>;
type Entry = { readonly schema: z.ZodType; readonly run: Run };

function entry<T>(
  schema: z.ZodType<T>,
  run: (db: Database, body: T, request: Request) => Promise<CollectionOutcome>,
): Entry {
  return { schema, run: run as Run };
}

const commands: ReadonlyMap<string, Entry> = new Map([
  ['create_collection', entry(createCollectionCommandSchema, createCollection)],
  ['update_collection', entry(updateCollectionCommandSchema, updateCollection)],
  ['add_property', entry(addPropertyCommandSchema, addProperty)],
  ['update_property', entry(updatePropertyCommandSchema, updateProperty)],
  ['change_property_type', entry(changePropertyTypeCommandSchema, changePropertyType)],
  ['remove_property', entry(removePropertyCommandSchema, removeProperty)],
  ['create_row', entry(createRowCommandSchema, createRow)],
  ['set_property', entry(setPropertyCommandSchema, setProperty)],
  ['move_card', entry(moveCardCommandSchema, moveCard)],
  ['save_view', entry(saveViewCommandSchema, saveView)],
  ['delete_view', entry(deleteViewCommandSchema, deleteView)],
  ['save_template', entry(saveTemplateCommandSchema, saveTemplate)],
]);

const STATUS_BY_REASON: ReadonlyMap<string, 400 | 403 | 404 | 409 | 422> = new Map([
  ['not_permitted', 403],
  ['collection_not_found', 404],
  ['row_not_found', 404],
  ['view_not_found', 404],
  ['template_not_found', 404],
  ['property_not_found', 404],
  ['collection_exists', 409],
  ['collection_locked', 409],
  ['rows_do_not_fit', 409],
  ['wip_limit_reached', 409],
]);

async function handleCommand(c: Context<AppEnv>): Promise<Response> {
  const command = commands.get(c.req.param('name') ?? '');
  if (command === undefined) return refuse(c, 'not_wired');
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const parsed = command.schema.safeParse(body);
  if (!parsed.success) return malformed(c, body);
  const request = {
    actor,
    traceId: c.get('traceId'),
    at: c.get('now'),
    newId: () => crypto.randomUUID(),
  };
  const outcome = await command.run(database.db, parsed.data as never, request);
  c.set('outcome', outcome.status === 'accepted' ? 'accepted' : outcome.reason);
  if (outcome.status === 'accepted') return c.json(outcome, 200);
  return c.json(outcome, STATUS_BY_REASON.get(outcome.reason) ?? 422);
}

function collectionApiRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/:name', handleCommand);
  routes.get('/', listCollections);
  routes.get('/:key', readCollection);
  routes.get('/:key/views/:viewId/rows', readViewRows);
  routes.get('/:key/views/:viewId/export', exportView);
  return routes;
}

function collectionScreenRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', collectionsScreen);
  routes.get('/:key', collectionScreen);
  routes.get('/:key/settings', collectionSettingsScreen);
  routes.get('/:key/views/:viewId', collectionViewScreen);
  routes.get('/:key/rows/:rowId', rowScreen);
  return routes;
}

export function mountCollections(app: Hono<AppEnv>): void {
  app.route('/api/collections', collectionApiRoutes());
  app.route('/collections', collectionScreenRoutes());
}
