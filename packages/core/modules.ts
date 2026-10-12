import { z } from 'zod';

export const dataClassificationSchema = z.enum(['public', 'internal', 'restricted', 'sensitive']);

export const offlineEligibilitySchema = z.enum(['sync', 'cache_readonly', 'never']);

export const moduleStatusSchema = z.enum(['core', 'standard', 'optional']);

const moduleKeySchema = z.string().regex(/^[a-z][a-z_]*$/);

const jdAreaSchema = z.string().regex(/^\d0-\d9$/);

export const moduleSchema = z.strictObject({
  key: moduleKeySchema,
  name: z.string().min(1),
  summary: z.string().min(1),
  jd_areas: z.array(jdAreaSchema),
  depends_on: z.array(moduleKeySchema),
  tables: z.array(z.string().min(1)),
  page_types: z.array(z.string().min(1)),
  routes: z.array(z.string().min(1)),
  mcp_tools: z.array(z.string().min(1)),
  queues: z.array(z.string().min(1)),
  crons: z.array(z.string().min(1)),
  data_classification: dataClassificationSchema,
  offline_eligibility: offlineEligibilitySchema,
  status: moduleStatusSchema,
});

export type Module = z.infer<typeof moduleSchema>;

const unclaimed = {
  jd_areas: [],
  tables: [],
  page_types: [],
  routes: [],
  mcp_tools: [],
  queues: [],
  crons: [],
} as const satisfies Partial<Module>;

export const modules = [
  {
    ...unclaimed,
    key: 'core',
    tables: [
      'people',
      'role_grants',
      'grant_audit',
      'pages',
      'page_versions',
      'webhook_deliveries',
      'queue_watermarks',
    ],
    routes: [
      '/health',
      '/api/me',
      '/api/acl/commands/:name',
      '/api/pages/commands/:name',
      '/api/pages/:pageId',
      '/webhooks/:source',
    ],
    queues: ['uw-ingest-events'],
    name: 'Core',
    summary:
      'Pages, versions, revisions and suggestions, search, the JD registry, the ACL, the policy engine, tasks and files.',
    depends_on: [],
    data_classification: 'restricted',
    offline_eligibility: 'never',
    status: 'core',
  },
  {
    ...unclaimed,
    key: 'agents',
    page_types: [
      'skill',
      'learning',
      'persona',
      'product',
      'system_goal',
      'product_strategy',
      'data_sources',
      'issue',
    ],
    mcp_tools: [
      'search_pages',
      'read_page',
      'write_page',
      'resolve_context',
      'query_entities',
      'create_task',
      'list_gifts',
      'create_draft_journal_entry',
      'poll_queue',
      'claim_item',
      'submit_to_gate',
      'record_run_step',
      'get_health',
    ],
    name: 'Agents',
    summary:
      'The MCP surface, the harness and its work queues, personas, institutional memory and skills.',
    depends_on: ['core'],
    data_classification: 'internal',
    offline_eligibility: 'sync',
    status: 'standard',
  },
] as const satisfies readonly Module[];

export type ModuleKey = (typeof modules)[number]['key'];
