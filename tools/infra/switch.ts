import { readFileSync } from 'node:fs';

const switchFile = 'infra/go-live.json';

function switchedOnIn(parsed: unknown): boolean | null {
  if (typeof parsed !== 'object' || parsed === null || !('switchedOn' in parsed)) return null;
  return typeof parsed.switchedOn === 'boolean' ? parsed.switchedOn : null;
}

export function parseSwitch(text: string): boolean {
  const switchedOn = switchedOnIn(JSON.parse(text));
  if (switchedOn === null) {
    throw new Error(`${switchFile} must read { "switchedOn": true } or { "switchedOn": false }`);
  }
  return switchedOn;
}

export function goLiveSwitchedOn(): boolean {
  return parseSwitch(readFileSync(switchFile, 'utf8'));
}
