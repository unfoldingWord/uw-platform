type HyperdriveBinding = { readonly connectionString: string };
export type QueueProducer<Body> = { send(body: Body): Promise<void> };

export type Bindings = {
  COMMIT_SHA?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_MCP_AUD?: string;
  DEV_PRINCIPAL_EMAIL?: string;
  HYPERDRIVE?: HyperdriveBinding;
  INGEST_DLQ?: QueueProducer<unknown>;
};

const UNKNOWN_COMMIT = 'unknown';

export function commitOf(env: Bindings): string {
  return env.COMMIT_SHA ?? UNKNOWN_COMMIT;
}
