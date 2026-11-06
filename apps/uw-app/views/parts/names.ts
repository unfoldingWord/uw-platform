export const pageNames = {
  home: 'Home',
  waiting: 'Waiting On You',
  myItems: 'My Items',
  personas: 'Personas',
  health: 'Health',
  notFound: 'Not Found',
  waitingApproval: 'Waiting For Approval',
  board: 'Board',
  flow: 'Flow',
  gate: 'Gate',
  item: 'Item',
} as const;

export const sectionNames = { harness: 'Harness', system: 'System' } as const;

const smallWord = /^[a-z]/;

export function titleCased(text: string): string {
  return text
    .split(' ')
    .map((word) =>
      smallWord.test(word) ? `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}` : word,
    )
    .join(' ');
}

export function isTitleCase(text: string): boolean {
  return text.split(' ').every((word) => word === 'unfoldingWord' || !smallWord.test(word));
}
