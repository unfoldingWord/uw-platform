import { raw } from 'hono/html';
import { themeSwitchScript } from './inline-scripts.ts';
import { SegmentedControl } from './segmented-control.tsx';

const choices = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemeSwitch() {
  return (
    <div id="uw-theme-switch">
      <SegmentedControl name="theme" legend="Colour theme" choices={choices} selected="system" />
      <script>{raw(themeSwitchScript)}</script>
    </div>
  );
}
