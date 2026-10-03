import axe from 'axe-core';
import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { GateCallout, GateFacts } from './gate-callout.tsx';
import { HumanActionButton } from './human-action.tsx';

async function dom(element: ReturnType<typeof jsx>): Promise<Document> {
  const markup = await element.toString();
  return new JSDOM(`<!DOCTYPE html><html lang="en"><body><main>${markup}</main></body></html>`)
    .window.document;
}

function found<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('not rendered');
  return value;
}

const headA = 'a'.repeat(40);
const headB = 'b'.repeat(40);
const approve = jsx(HumanActionButton, { label: 'Approve', name: 'decision', value: 'approve' });

const declaration = {
  closes: ['#12', 'unfoldingWord/platform#7'],
  risks: 'Changes who may read a harness',
  touches: 'The access check',
  riskTier: 'high',
  riskDomains: ['acl'],
};

const facts = {
  declaration,
  riskDerived: { riskTier: 'high', riskDomains: ['acl', 'money'], head: headA },
  approvingHead: headA,
};

function definitions(document: Document): Map<string, string> {
  const terms = [...document.querySelectorAll('dt')];
  return new Map(
    terms.map((term) => [
      term.textContent ?? '',
      term.nextElementSibling?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    ]),
  );
}

describe('WB-11 the gate callout', () => {
  it('WB-11 the gate callout is a labelled region whose heading names the gate, with the reason in place when the rule refuses', async () => {
    const document = await dom(
      jsx(GateCallout, { title: 'Ship', reason: 'checks_not_green', actions: approve }),
    );
    const region = found(document.querySelector('section'));
    const heading = found(document.getElementById(found(region.getAttribute('aria-labelledby'))));
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent).toBe('Ship');
    expect(region.contains(heading)).toBe(true);
    expect(found(region.querySelector('[role="note"]')).textContent).toBe('Checks not green');
    expect(found(region.querySelector('button')).textContent).toBe('Approve');
    expect(region.outerHTML).not.toMatch(/red/);
  });

  it('a gate callout the rule allows shows no reason', async () => {
    const document = await dom(jsx(GateCallout, { title: 'Ship', reason: null, actions: approve }));
    expect(document.querySelector('[role="note"]')).toBeNull();
  });

  it('a gate callout escapes its title, its reason and its children', async () => {
    const document = await dom(
      jsx(GateCallout, {
        title: '<b>t</b>',
        reason: '<i>r</i>',
        actions: approve,
        children: '<script>x</script>',
      }),
    );
    expect(document.querySelector('b, i, script')).toBeNull();
    expect(document.querySelector('h2')?.textContent).toBe('<b>t</b>');
  });
});

describe('the gate callout shows the parsed declaration, never the pull request body', () => {
  it('the gate facts show the parsed declaration, the derived tier and domains with the head they were derived at, and the head you approve', async () => {
    const document = await dom(jsx(GateFacts, facts));
    const shown = definitions(document);
    expect(shown.get('Declared tier')).toBe('high');
    expect(shown.get('Declared domains')).toBe('acl');
    expect(shown.get('Closes')).toBe('#12, unfoldingWord/platform#7');
    expect(shown.get('Risks')).toBe('Changes who may read a harness');
    expect(shown.get('Touches')).toBe('The access check');
    expect(shown.get('Derived tier')).toBe(`high at ${headA}`);
    expect(shown.get('Derived domains')).toBe('acl, money');
    expect(shown.get('You approve head')).toBe(headA);
  });

  it('the gate facts say when the tier was derived at another head than the one you approve', async () => {
    const document = await dom(jsx(GateFacts, { ...facts, approvingHead: headB }));
    expect(document.body.textContent).toContain('The tier was derived at another head');
    expect(definitions(document).get('You approve head')).toBe(headB);
  });

  it('the gate facts say when no declaration was parsed, and when no tier was derived', async () => {
    const document = await dom(
      jsx(GateFacts, { declaration: null, riskDerived: null, approvingHead: null }),
    );
    const shown = definitions(document);
    expect(shown.get('Declaration')).toBe('No declaration was parsed from the pull request');
    expect(shown.get('Derived tier')).toBe('Not derived');
    expect(shown.get('You approve head')).toBe('No head');
  });

  it('the gate facts escape every declared string', async () => {
    const document = await dom(
      jsx(GateFacts, {
        ...facts,
        declaration: { ...declaration, risks: '<img src=x onerror=alert(1)>', touches: '<b>t</b>' },
      }),
    );
    expect(document.querySelector('img, b')).toBeNull();
    expect(definitions(document).get('Risks')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('the gate callout passes axe-core', () => {
  it('has no axe-core violations with its facts, its reason and its action', async () => {
    const callout = jsx(GateCallout, {
      title: 'Ship',
      reason: 'checks_not_green',
      actions: approve,
      children: jsx(GateFacts, facts),
    });
    const window = new JSDOM(
      `<!DOCTYPE html><html lang="en"><head><title>t</title></head><body><main><form>${await callout.toString()}</form></main></body></html>`,
      { runScripts: 'outside-only' },
    ).window;
    window.eval(axe.source);
    const runner = (window as unknown as { axe: typeof axe }).axe;
    const results = await runner.run(window.document, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.passes.map((pass) => pass.id)).toEqual(
      expect.arrayContaining(['button-name', 'dlitem']),
    );
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    window.close();
  });
});
