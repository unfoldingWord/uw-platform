export const pageNames = {
  home: 'Today',
  waiting: 'Waiting On You',
  agentQueues: 'Agent Queues',
  infrastructure: 'Infrastructure',
  health: 'Health',
  notFound: 'Not Found',
  waitingApproval: 'Waiting For Approval',
  board: 'Board',
  flow: 'Flow',
  gate: 'Gate',
  item: 'Item',
} as const;

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
