export const claimLabel = /^\[(observed|confirmed|inferred|assumed)\]\s+\S/;

const claimLine = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/;

const lineBreak = /\r\n|\r|\n|\u2028|\u2029/;

export function checkClaims(bodyMd: string): {
  readonly claims: number;
  readonly unlabelled: readonly string[];
} {
  const texts = bodyMd
    .split(lineBreak)
    .map((line) => claimLine.exec(line)?.[1])
    .filter((text): text is string => text !== undefined);
  return { claims: texts.length, unlabelled: texts.filter((text) => !claimLabel.test(text)) };
}
