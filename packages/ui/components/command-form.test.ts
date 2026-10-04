import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { CommandForm, commandButton } from './command-form.tsx';
import { domId } from './text.ts';

async function documentOf(element: ReturnType<typeof jsx>): Promise<Document> {
  return new JSDOM(`<!DOCTYPE html><body>${await element.toString()}</body>`).window.document;
}

describe('the command form', () => {
  it('the command form names its command and harness and has a status region', async () => {
    const button = jsx('button', { type: 'submit', class: commandButton, children: 'Claim' });
    const document = await documentOf(
      jsx(CommandForm, { harnessId: 'h1', command: 'claim', itemId: 'i1', children: button }),
    );
    const form = document.querySelector('form');
    expect(form?.getAttribute('data-command')).toBe('claim');
    expect(form?.getAttribute('data-harness')).toBe('h1');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.id).toBe(domId('form', 'claim', 'i1'));
    const outcome = form?.querySelector('[data-outcome]');
    expect(outcome?.getAttribute('role')).toBe('status');
    expect(outcome?.getAttribute('aria-live')).toBe('polite');
    expect(form?.querySelector('button')?.getAttribute('class')).toContain(
      'focus-visible:outline-2',
    );
  });

  it('takes its id from the harness when no item is named', async () => {
    const document = await documentOf(
      jsx(CommandForm, { harnessId: 'h1', command: 'enqueue', children: '' }),
    );
    expect(document.querySelector('form')?.id).toBe(domId('form', 'enqueue', 'h1'));
  });
});
