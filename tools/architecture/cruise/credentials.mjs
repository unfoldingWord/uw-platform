import { npm, testFile } from './shared.mjs';

const kmsClient = '^apps/uw-platform/credentials/kms/';

const store = '^apps/uw-platform/credentials/';
const opensAValue = '^apps/uw-platform/credentials/(open|envelope|outcome-guard)\\.ts$';
const revealsAValue = '^apps/uw-platform/credentials/reveal\\.ts$';
const revealRoute = '^apps/uw-platform/credentials/routes\\.ts$';
const usesAValue = '^apps/uw-platform/credentials/(use|secret)\\.ts$';
const connectorsAdapter = '^apps/uw-platform/ports/connectors\\.ts$';
const agentSurface = '^apps/uw-platform/(mcp|engines|runs|agents)/';

export const credentialRules = [
  {
    name: 'aws-signer-only-in-the-kms-client',
    comment:
      'The AWS request signer is imported only by the KMS client in apps/uw-platform/credentials/kms/, so no other module signs a request with the key-encryption credentials.',
    severity: 'error',
    from: { pathNot: [kmsClient, testFile] },
    to: { path: npm('aws4fetch') },
  },
  {
    name: 'kms-client-only-in-the-credentials-store',
    comment:
      'Only the credentials store reaches the KMS client, so a data key is wrapped and unwrapped in one place.',
    severity: 'error',
    from: { pathNot: ['^apps/uw-platform/credentials/', testFile] },
    to: { path: kmsClient },
  },
  {
    name: 'credential-value-opened-only-inside-the-store',
    comment:
      'Only the credentials store opens a sealed value, so every open passes can(), the access log and the outcome guard. A caller outside the store asks useCredential. Inside the store two files call openCredential: use.ts for a connector, and reveal.ts for a person who holds a reveal grant (#159).',
    severity: 'error',
    from: { pathNot: [store, testFile] },
    to: { path: opensAValue },
  },
  {
    name: 'credential-revealed-only-by-its-route',
    comment:
      'Only the credential routes ask for a reveal, so a value reaches a person in one uncached answer to POST /api/credentials/reveal and no screen, command, cron job, connector or other store file returns one (#159, ADR 0021).',
    severity: 'error',
    from: { pathNot: [revealsAValue, revealRoute, testFile] },
    to: { path: revealsAValue },
  },
  {
    name: 'credential-used-only-by-a-connector',
    comment:
      'Only the connectors adapter asks the store to use a credential or handles a Secret, so a value is exposed only where the platform calls an outside service (#158).',
    severity: 'error',
    from: { pathNot: [store, connectorsAdapter, testFile] },
    to: { path: usesAValue },
  },
  {
    name: 'no-credential-store-on-the-agent-surface',
    comment:
      'No MCP verb, engine, run host or agent module imports the credentials store, so no tool reply, prompt or run step can carry a value and no agent manages a credential (#158, ADR 0020).',
    severity: 'error',
    from: { path: agentSurface, pathNot: [testFile] },
    to: { path: store },
  },
];
