const scenarioFile = /^sim\/scenarios\/([A-Z]{2}-\d+)\.[a-z0-9-]+\.ts$/;
const titled = /['"`]([A-Z]{2}-\d+ [^'"`]*)/g;
const requirementId = /^[A-Z]{2}-\d+$/;

export const provingTestFile = /^(?:apps|packages|tools|sim)\/.*\.test\.ts$/;

export function scenarioProofs(paths: readonly string[]): string[] {
  return paths.flatMap((path) => {
    const match = scenarioFile.exec(path);
    return match?.[1] ? [match[1]] : [];
  });
}

function leadingIds(title: string): string[] {
  const words = title.split(' ');
  const end = words.findIndex((word) => !requirementId.test(word));
  return end === -1 ? words : words.slice(0, end);
}

export function testProofs(source: string): string[] {
  return [...source.matchAll(titled)].flatMap(([, title]) => leadingIds(title ?? ''));
}
