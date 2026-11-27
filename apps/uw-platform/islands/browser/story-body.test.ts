import { describe, expect, it } from 'vitest';
import { commandBody } from './command-body.ts';
import { OUTCOME_TEXT } from './command-form.ts';

const requestId = 'f0000000-0000-4000-8000-000000000201';
const pageId = 'a0000000-0000-4000-8000-000000000201';

describe('#201 the story controls send the person commands', () => {
  it('#201 builds a level change and a withdrawal from the page id', () => {
    expect(commandBody('set_story_level', { pageId, level: 'newsletter' }, requestId)).toEqual({
      command: 'set_story_level',
      requestId,
      pageId,
      level: 'newsletter',
    });
    expect(commandBody('withdraw_story_consent', { pageId }, requestId)).toEqual({
      command: 'withdraw_story_consent',
      requestId,
      pageId,
    });
  });

  it('#201 builds a consent record, reading yes and no and leaving blank days null', () => {
    const fields = {
      pageId,
      consentReference: 'https://files.example.org/releases/release-002.pdf',
      consentedBy: 'Bo Example',
      consentForm: 'written',
      consentedOn: '2026-11-02',
      consentExpires: '',
      anonymised: 'true',
      nameUse: 'none',
      locationPrecision: 'country',
      photoRelease: 'false',
      photoReference: '',
      reviewOn: '2027-05-02',
    };
    expect(commandBody('record_story_consent', fields, requestId)).toEqual({
      command: 'record_story_consent',
      requestId,
      ...fields,
      consentExpires: null,
      anonymised: true,
      photoRelease: false,
      photoReference: null,
    });
  });

  it('#201 says what each story control did', () => {
    for (const command of ['set_story_level', 'record_story_consent', 'withdraw_story_consent']) {
      expect(OUTCOME_TEXT[command]).toBeDefined();
    }
  });
});

describe('ADR 0041 the expression controls send the person commands', () => {
  const expressionId = 'b0000000-0000-4000-8000-000000004101';
  const fields = {
    title: 'Twelve readers at the well',
    format: 'social_post',
    venue: 'Social media',
    channel: 'public',
    url: 'https://social.example.org/posts/region-one-well',
    language: '',
    publishedOn: '2026-10-01',
    excerpt: '',
  };

  it('ADR 0041 builds an added expression, leaving a blank language and excerpt null', () => {
    expect(commandBody('add_story_expression', { pageId, ...fields }, requestId)).toEqual({
      command: 'add_story_expression',
      requestId,
      pageId,
      ...fields,
      language: null,
      excerpt: null,
    });
  });

  it('ADR 0041 builds a confirmation and a retirement from the expression id alone', () => {
    for (const command of ['confirm_story_expression', 'retire_story_expression']) {
      expect(commandBody(command, { expressionId }, requestId)).toEqual({
        command,
        requestId,
        expressionId,
      });
      expect(OUTCOME_TEXT[command]).toBeDefined();
    }
  });
});
