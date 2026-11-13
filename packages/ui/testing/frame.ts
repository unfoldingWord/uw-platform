import type { Frame } from '../components/shell.tsx';
import type { NavItem, NavSection } from '../components/sidebar.tsx';

export const testItems: readonly NavItem[] = [
  { label: 'Home', icon: 'house', href: '/', code: '00' },
  { label: 'Health', icon: 'wave-pulse', href: '/health', code: '38' },
  { label: 'Ledger', icon: 'scale-balanced' },
];

export function testFrame(items: readonly NavItem[] = testItems): Frame {
  const sections: readonly NavSection[] = [{ heading: 'Infrastructure', code: '30-39', items }];
  return {
    sections,
    person: { initials: 'IL', name: 'Ian Lindsley', role: 'admin · 80-89' },
    waiting: 2,
    wordmarkPath: '/assets/uw-logo-white-0123456789ab.png',
    status: {
      loaded: '14:02 UTC',
      agents: 4,
      gatesOpen: 2,
      queue: false,
      live: true,
      databaseMs: 4,
      commit: 'bf10f9f0000000000000000000000000000000000',
      environment: 'staging',
    },
  };
}
