import { bannedDateText, datesModule } from './date-patterns.ts';

export type DateViolation = { path: string; line: number; text: string };

const scannedExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/;

const exempt = [datesModule, 'tools/lint/date-patterns.ts'];

const exemptTest = /^tools\/lint\/[^/]+\.test\.ts$/;

export function isScanned(path: string): boolean {
  return scannedExtension.test(path) && !exempt.includes(path) && !exemptTest.test(path);
}

export function findDateViolations(path: string, source: string): DateViolation[] {
  return source
    .split('\n')
    .flatMap((text, index) =>
      bannedDateText.test(text) ? [{ path, line: index + 1, text: text.trim() }] : [],
    );
}
