import type { Frame } from '../components/shell.tsx';
import type { NavItem, NavSection } from '../components/sidebar.tsx';

export const testItems: readonly NavItem[] = [
  { label: 'Home', mark: { icon: 'house' }, href: '/' },
  { label: 'Health', mark: { icon: 'wave-pulse' }, href: '/health' },
];

export function testFrame(items: readonly NavItem[] = testItems): Frame {
  const sections: readonly NavSection[] = [{ items }];
  return {
    sections,
    person: { initials: 'IL', name: 'Ian Lindsley', role: 'admin · 80-89' },
    waiting: 2,
    markPath: '/assets/uw-logo-mark-0123456789ab.png',
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
