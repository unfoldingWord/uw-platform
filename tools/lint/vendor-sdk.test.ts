import { describe, expect, it } from 'vitest';
import { findVendorViolations, isVendorScanned } from './vendor-sdk.ts';

const violates = (source: string) => findVendorViolations('apps/uw-app/a.ts', source).length;

describe('the vendor SDK text gate', () => {
  it.each([
    "import Anthropic from '@anthropic-ai/sdk';",
    "import OpenAI from 'openai';",
    "import { x } from 'openai/resources';",
    "import { x } from '@openrouter/sdk';",
    "const sdk = await import('@anthropic-ai/claude-agent-sdk');",
    "const sdk = require('openai');",
  ])('refuses %s', (source) => {
    expect(violates(source)).toBe(1);
  });

  it.each([
    "import { Hono } from 'hono';",
    "const label = 'openai is a vendor';",
    "import { engine } from './engines/openrouter-messages.ts';",
  ])('accepts %s', (source) => {
    expect(violates(source)).toBe(0);
  });

  it('scans application, package and sim code but not an engine directory', () => {
    expect(isVendorScanned('apps/uw-app/routes/a.ts')).toBe(true);
    expect(isVendorScanned('packages/harness/a.ts')).toBe(true);
    expect(isVendorScanned('sim/a.ts')).toBe(true);
    expect(isVendorScanned('apps/uw-app/engines/claude-messages/a.ts')).toBe(false);
    expect(isVendorScanned('apps/uw-app/engines/gateway/spend.ts')).toBe(true);
    expect(isVendorScanned('apps/uw-app/engines/registry.ts')).toBe(true);
    expect(isVendorScanned('tools/lint/vendor-sdk.ts')).toBe(false);
  });

  it('reports the line and the trimmed text', () => {
    const found = findVendorViolations('apps/uw-app/a.ts', "const a = 1;\n  import 'openai';");
    expect(found).toEqual([{ path: 'apps/uw-app/a.ts', line: 2, text: "import 'openai';" }]);
  });
});
