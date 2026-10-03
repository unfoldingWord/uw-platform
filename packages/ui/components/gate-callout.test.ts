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
const itemA = '0b6f1c1e-4a5d-4c3b-9e2f-1a2b3c4d5e6f';
const itemB = '7d3e2f1a-9b8c-4d5e-8f6a-0b1c2d3e4f5a';
const approve = jsx(HumanActionButton, {
  itemId: itemA,
  label: 'Approve',
  name: 'decision',
  value: 'approve',
});

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
  head: headA,
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
      jsx(GateCallout, {
        itemId: itemA,
        title: 'Ship',
        reason: 'checks_not_green',
        actions: approve,
      }),
    );
    const region = found(document.querySelector('section'));
    const heading = found(document.getElementById(found(region.getAttribute('aria-labelledby'))));
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent).toBe('Ship');
    expect(region.contains(heading)).toBe(true);
    expect(found(region.querySelector('[role="note"]')).textContent).toBe('Checks not green');
    expect(found(region.querySelector('button')).textContent).toBe('Approve');
    expect(region.outerHTML).not.toMatch(/\b(?:text|bg|border|outline)-red\b/);
  });

  it('a gate callout the rule allows shows no reason', async () => {
    const document = await dom(
      jsx(GateCallout, { itemId: itemA, title: 'Ship', reason: null, actions: approve }),
    );
    expect(document.querySelector('[role="note"]')).toBeNull();
  });

  it('a gate callout escapes its title, its reason and its children', async () => {
    const document = await dom(
      jsx(GateCallout, {
        itemId: itemA,
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
    expect(shown.get('Tier recorded')).toBe(`high at ${headA}`);
    expect(shown.get('Domains recorded')).toBe('acl, money');
    expect(shown.get('You approve head')).toBe(headA);
    expect(shown.has('Tier derived now')).toBe(false);
    expect(shown.has('Review providers')).toBe(false);
  });

  it('the gate facts show the tier the rule derives now beside the recorded one, and the review providers', async () => {
    const document = await dom(
      jsx(GateFacts, {
        ...facts,
        derivedNow: { riskTier: 'critical', riskDomains: ['acl'], head: headB },
        reviewProviders: ['codex', 'human'],
      }),
    );
    const shown = definitions(document);
    expect(shown.get('Tier recorded')).toBe(`high at ${headA}`);
    expect(shown.get('Tier derived now')).toBe(`critical at ${headB}`);
    expect(shown.get('Domains derived now')).toBe('acl');
    expect(shown.get('Review providers')).toBe('codex, human');
  });

  it('the gate facts say when the tier was recorded at another head than the one you approve', async () => {
    const document = await dom(jsx(GateFacts, { ...facts, head: headB }));
    expect(document.body.textContent).toContain('The tier was recorded at another head');
    expect(definitions(document).get('You approve head')).toBe(headB);
  });

  it('the gate facts say when no declaration was parsed, and when no tier was derived', async () => {
    const document = await dom(
      jsx(GateFacts, { declaration: null, riskDerived: null, head: null }),
    );
    const shown = definitions(document);
    expect(shown.get('Declaration')).toBe('No declaration was parsed from the pull request');
    expect(shown.get('Tier recorded')).toBe('Not derived');
    expect(shown.get('You approve head')).toBe('No head');
  });
});

describe('the gate facts send the head they show', () => {
  it('the head you are shown is the head the approve sends, from one value', async () => {
    const document = await dom(jsx(GateFacts, { ...facts, head: headB }));
    const sent = found(document.querySelector('input[type="hidden"][name="head"]'));
    expect(sent.getAttribute('value')).toBe(headB);
    expect(definitions(document).get('You approve head')).toBe(sent.getAttribute('value'));
    expect(document.querySelectorAll('[name="head"]')).toHaveLength(1);
  });

  it('with no head the facts send none', async () => {
    const document = await dom(jsx(GateFacts, { ...facts, head: null }));
    expect(document.querySelector('[name="head"]')).toBeNull();
  });
});

describe('the gate facts escape what they show', () => {
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

describe('the gate callout ids', () => {
  it('two gate callouts with the same title label themselves by their own item', async () => {
    const page = [
      jsx(GateCallout, { itemId: itemA, title: 'Ship', reason: null, actions: approve }),
      jsx(GateCallout, { itemId: itemB, title: 'Ship', reason: null, actions: 'x' }),
    ];
    const markup = (await Promise.all(page.map((part) => part.toString()))).join('');
    const document = new JSDOM(`<!DOCTYPE html><body>${markup}</body>`).window.document;
    const headings = [...document.querySelectorAll('section')].map((region) =>
      found(document.getElementById(found(region.getAttribute('aria-labelledby')))),
    );
    expect(headings[0]).not.toBe(headings[1]);
    expect(headings.map((heading) => heading.closest('section'))).toEqual([
      ...document.querySelectorAll('section'),
    ]);
  });
});

describe('the gate callout passes axe-core', () => {
  it('has no axe-core violations with its facts, its reason and its action', async () => {
    const callout = jsx(GateCallout, {
      itemId: itemA,
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
