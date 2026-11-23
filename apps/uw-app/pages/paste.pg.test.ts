import { describe, expect, it } from 'vitest';
import { pastedMarkdownReplySchema } from '@uw/contracts';
import { person, post } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const CONVERT = '/api/pages/editor-html';
const PASTED = '## Overview\n\nSee [the index](https://johnnydecimal.com/).\n\n- [ ] Read it';

describe.skipIf(!testServer)('pasted markdown is converted for the page editor', () => {
  it('gives a page writer the editor HTML for pasted markdown', () =>
    withAppDatabase(async (db) => {
      const writer = await person(db, 'paste-writer', 'editor', '00-09');
      const sent = await post(db, writer.email, CONVERT, { markdown: PASTED });
      expect(sent.status).toBe(200);
      const { html } = pastedMarkdownReplySchema.parse(sent.body);
      expect(html).toContain('<h2');
      expect(html).toContain('href="https://johnnydecimal.com/"');
      expect(html).toContain('data-type="taskItem"');
    }));

  it('drops script from what was pasted', () =>
    withAppDatabase(async (db) => {
      const writer = await person(db, 'paste-script', 'editor', '00-09');
      const markdown = '## Hi\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))';
      const sent = await post(db, writer.email, CONVERT, { markdown });
      const { html } = pastedMarkdownReplySchema.parse(sent.body);
      expect(html).not.toContain('<script');
      expect(html).not.toContain('javascript:');
    }));

  it('refuses a person who can only read pages', () =>
    withAppDatabase(async (db) => {
      const reader = await person(db, 'paste-reader', 'viewer', '00-09');
      const sent = await post(db, reader.email, CONVERT, { markdown: PASTED });
      expect(sent.status).toBe(403);
      expect(sent.body['reason']).toBe('not_permitted');
    }));

  it('refuses an empty paste as malformed', () =>
    withAppDatabase(async (db) => {
      const writer = await person(db, 'paste-empty', 'editor', '00-09');
      const sent = await post(db, writer.email, CONVERT, { markdown: '' });
      expect(sent.status).toBe(400);
      expect(sent.body['reason']).toBe('malformed_command');
    }));
});
