import { storyCommandSchemas } from '@uw/contracts';
import type { ZodType } from 'zod';

type Given = ReadonlyMap<string, string>;
type Shape = (given: Given) => Readonly<Record<string, unknown>>;

function given(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function yes(raw: string | undefined): boolean {
  return raw === 'true';
}

const consent: Shape = (fields) => ({
  pageId: fields.get('pageId'),
  consentReference: fields.get('consentReference'),
  consentedBy: fields.get('consentedBy'),
  consentForm: fields.get('consentForm'),
  consentedOn: fields.get('consentedOn'),
  consentExpires: given(fields.get('consentExpires')),
  anonymised: yes(fields.get('anonymised')),
  nameUse: fields.get('nameUse'),
  locationPrecision: fields.get('locationPrecision'),
  photoRelease: yes(fields.get('photoRelease')),
  photoReference: given(fields.get('photoReference')),
  reviewOn: given(fields.get('reviewOn')),
});

export const storySchemas: ReadonlyMap<string, ZodType> = new Map<string, ZodType>(
  Object.entries(storyCommandSchemas),
);

export const storyShapes: ReadonlyMap<string, Shape> = new Map<string, Shape>([
  ['set_story_level', (fields) => ({ pageId: fields.get('pageId'), level: fields.get('level') })],
  [
    'set_story_media_level',
    (fields) => ({
      pageId: fields.get('pageId'),
      fileId: fields.get('fileId'),
      level: fields.get('level'),
    }),
  ],
  ['record_story_consent', consent],
  ['withdraw_story_consent', (fields) => ({ pageId: fields.get('pageId') })],
]);
