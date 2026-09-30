export const datesModule = 'packages/core/dates.ts';

export const bannedDateMethods = [
  'toLocaleDateString',
  'toLocaleString',
  'toLocaleTimeString',
  'toDateString',
  'toTimeString',
  'toUTCString',
  'toGMTString',
] as const;

export const bannedIntlFormatters = ['DateTimeFormat', 'RelativeTimeFormat'] as const;

export const isoStringCutters = ['slice', 'substring', 'substr', 'split'] as const;

export const dateFormatToken =
  /\b(?:YYYY|yyyy|YYYYMMDD|yyyyMMdd)\b|\b(?:MM|DD|dd)[/.-](?:MM|DD|dd|YY|yy|YYYY|yyyy)\b|\bMMMM?\s+(?:Do|DD?|dd?)\b|\b(?:HH|hh):mm\b/;

const alternatives = (words: readonly string[]): string => words.join('|');

export const bannedDateText = new RegExp(
  [
    `\\b(?:${alternatives(bannedDateMethods)})\\b`,
    `\\bIntl\\s*\\.\\s*(?:${alternatives(bannedIntlFormatters)})\\b`,
    `\\btoISOString\\(\\)\\s*\\.\\s*(?:${alternatives(isoStringCutters)})\\b`,
    dateFormatToken.source,
  ].join('|'),
);
