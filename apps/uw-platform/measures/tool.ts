import { siteOrigins, type MeasureFrontmatter, type MeasureSchedule } from '@uw/contracts';
import { canonicalJson, sha256Hex } from '../pdf/provenance.ts';

type Tool = Pick<MeasureFrontmatter, 'runtime' | 'package' | 'command' | 'resources'>;

const RUN_HOUR_UTC = 6;
const DAY_MS = 86_400_000;
const WEB = new Set(['http:', 'https:']);
const LONGEST_ADDRESS = 2048;
const MINUTES = 60;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function toolHashOf(measure: Tool): Promise<string> {
  const { runtime, package: pinned, command, resources } = measure;
  return sha256Hex(canonicalJson({ runtime, package: pinned, command, resources }));
}

export function hostOf(address: string): string | null {
  if (!URL.canParse(address)) return null;
  const url = new URL(address);
  return WEB.has(url.protocol) && url.host !== '' ? url.host : null;
}

export function hostsReached(address: string): readonly string[] {
  if (hostOf(address) === null) return [];
  return siteOrigins(new URL(address).origin).map((origin) => new URL(origin).host);
}

export function measurableAddress(address: string): boolean {
  if (address.length > LONGEST_ADDRESS || hostOf(address) === null) return false;
  const url = new URL(address);
  return url.username === '' && url.password === '';
}

export function filledCommand(command: readonly string[], address: string): readonly string[] {
  const host = hostOf(address) ?? '';
  return command.map((argument) =>
    argument.replace(/\{address\}|\{host\}/g, (token) => (token === '{host}' ? host : address)),
  );
}

export function runMinuteOf(measureId: string): number {
  let hash = FNV_OFFSET;
  for (let index = 0; index < measureId.length; index += 1) {
    hash = Math.imul(hash ^ measureId.charCodeAt(index), FNV_PRIME) >>> 0;
  }
  return hash % MINUTES;
}

function slotOn(day: Date, minute: number): Date {
  const [year, month, date] = [day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()];
  return new Date(Date.UTC(year, month, date, RUN_HOUR_UTC, minute));
}

function fits(schedule: MeasureSchedule, slot: Date): boolean {
  if (schedule.every === 'day') return true;
  if (schedule.every === 'week') return slot.getUTCDay() === schedule.weekday;
  return slot.getUTCDate() === schedule.day;
}

export function nextRunAfter(schedule: MeasureSchedule, after: Date, measureId: string): Date {
  let slot = slotOn(after, runMinuteOf(measureId));
  if (slot.getTime() <= after.getTime()) slot = new Date(slot.getTime() + DAY_MS);
  while (!fits(schedule, slot)) slot = new Date(slot.getTime() + DAY_MS);
  return slot;
}
