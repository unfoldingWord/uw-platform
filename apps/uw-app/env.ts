import type { RunStart } from '@uw/harness';
type HyperdriveBinding = { readonly connectionString: string };
export type QueueProducer<Body> = { send(body: Body): Promise<void> };
type HubStub = { fetch(input: string, init?: RequestInit): Promise<Response> };
export type HubNamespace = { idFromName(name: string): unknown; get(id: unknown): HubStub };
export type WorkflowInstance = {
  readonly id: string;
  status(): Promise<{ readonly status: string }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  terminate(): Promise<void>;
  sendEvent(event: { readonly type: string; readonly payload: unknown }): Promise<void>;
};
export type WorkflowBinding = {
  create(options: { readonly id: string; readonly params: RunStart }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
};

export type Bindings = {
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ANALYTICS_TOKEN?: string;
  AI_GATEWAY_ID?: string;
  AI_GATEWAY_TOKEN?: string;
  AI_SPEND_CAP_MINOR?: string;
  ALWAYS_ON_MODEL?: string;
  ALWAYS_ON_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  COMMIT_SHA?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_MCP_AUD?: string;
  DEV_PRINCIPAL_EMAIL?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  HARNESS_HUB?: HubNamespace;
  HARNESS_RUN?: WorkflowBinding;
  HYPERDRIVE?: HyperdriveBinding;
  INGEST_DLQ?: QueueProducer<unknown>;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  SANDBOX_MINOR_PER_HOUR?: string;
};

const UNKNOWN_COMMIT = 'unknown';

export function commitOf(env: Bindings): string {
  return env.COMMIT_SHA ?? UNKNOWN_COMMIT;
}
