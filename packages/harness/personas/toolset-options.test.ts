import {
  isForbiddenVerbName,
  principalSchema,
  verbRegistry,
  type Principal,
  type Role,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { toolsetOptions } from './toolset-options.ts';

const at = new Date('2026-10-03T09:00:00.000Z');
const personId = '00000000-0000-4000-8000-000000000301';

function person(role: Role): Principal {
  return principalSchema.parse({
    identity: `human:${personId}`,
    kind: 'person',
    personId,
    email: 'p@unfoldingword.org',
    grants: [
      {
        grantId: '00000000-0000-4000-8000-000000000302',
        role,
        scopeKind: 'jd_area',
        scopeArea: '80-89',
        expiresAt: null,
      },
    ],
    interactive: true,
  });
}

describe('the toolset form options', () => {
  it('PE-2 the toolset form offers only served registry verbs the creator reaches, never a forbidden verb', () => {
    const editor = toolsetOptions(person('editor'), '80-89', at);
    const viewer = toolsetOptions(person('viewer'), '80-89', at);
    const served = verbRegistry.filter((verb) => verb.servedInV1).map((verb) => verb.name);
    expect(editor).toEqual(served.filter((verb) => editor.includes(verb)));
    expect(editor).toEqual(
      expect.arrayContaining([
        'search_pages',
        'read_page',
        'write_page',
        'resolve_context',
        'query_entities',
        'create_task',
        'poll_queue',
        'claim_item',
        'submit_to_gate',
        'record_run_step',
        'get_health',
      ]),
    );
    expect(editor).not.toContain('list_gifts');
    expect(viewer.length).toBeLessThan(editor.length);
    expect(viewer).not.toContain('write_page');
    expect(viewer).toContain('read_page');
    expect([...editor, ...viewer].filter(isForbiddenVerbName)).toEqual([]);
    expect(toolsetOptions(person('editor'), '30-39', at)).not.toContain('write_page');
  });
});
