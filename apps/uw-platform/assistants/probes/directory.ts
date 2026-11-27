import { googleDirectory, type Directory, type DirectoryAnswer } from '../google/directory.ts';
import { checked, skipped, type ProbeResult } from './report.ts';
import { googleRig, type GoogleRig } from './google.ts';
import { notConfigured, WRITES_ONLY, type ProbeDeps } from './setup.ts';

const SETTINGS = [
  'GOOGLE_WORKSPACE_KEY',
  'GOOGLE_WORKSPACE_DOMAIN',
  'GOOGLE_WORKSPACE_ADMIN_SUBJECT',
  'GOOGLE_ASSISTANT_OU',
  'PROBE_PERSON_EMAIL',
];
const READS = ['s6.1', 's13.1'];
const WRITES = ['s6.2', 's6.3', 's6.4'];

function said<T>(answer: DirectoryAnswer<T>, value: (found: T) => string): string {
  return answer.ok ? value(answer.value) : answer.failure;
}

async function lookups(directory: Directory, rig: GoogleRig, suffix: string, admin: string) {
  const known = await directory.user(admin);
  const free = await directory.user(`uwprobefree${suffix}@${rig.domain}`);
  const ok = known.ok && known.value !== null && free.ok && free.value === null;
  const detail = `admin subject ${said(known, (user) => (user === null ? 'not found' : 'found'))}, free address ${said(free, (user) => (user === null ? 'free' : 'taken'))}`;
  return checked('s6.1', ok, detail);
}

async function groupLookup(directory: Directory, rig: GoogleRig, suffix: string) {
  const free = await directory.group(`uwprobefree${suffix}@${rig.domain}`);
  const ok = free.ok && free.value === null;
  const detail = `groups.get on a free address ${said(free, (group) => (group === null ? 'answered 404, free' : 'found a group'))}`;
  return checked('s13.1', ok, detail);
}

async function inserted(directory: Directory, address: string, ou: string) {
  const user = {
    address,
    givenName: 'Uwprobe',
    familyName: 'Assistant',
    orgUnitPath: ou,
    harnessId: crypto.randomUUID(),
  };
  const made = await directory.insert(user);
  const again = await directory.insert(user);
  const conflict = !again.ok && again.failure === 'conflict';
  const detail = `insert ${said(made, (found) => found.id)}, again ${said(again, () => 'answered 200')}`;
  return {
    result: checked('s6.2', made.ok && conflict, detail),
    id: made.ok ? made.value.id : null,
  };
}

async function suspension(directory: Directory, id: string, address: string): Promise<ProbeResult> {
  const off = await directory.setSuspended(id, true);
  const seen = await directory.user(address);
  const on = await directory.setSuspended(id, false);
  const suspended = seen.ok && seen.value?.suspended === true;
  const detail = `suspend ${off.ok ? 'ok' : off.failure}, read suspended ${String(suspended)}, restore ${on.ok ? 'ok' : on.failure}`;
  return checked('s6.3', off.ok && suspended && on.ok, detail);
}

async function removal(directory: Directory, id: string, address: string): Promise<ProbeResult> {
  const gone = await directory.remove(id);
  const after = await directory.user(address);
  const again = await directory.remove(id);
  const detail = `delete ${gone.ok ? 'ok' : gone.failure}, read after ${said(after, (user) => (user === null ? 'free' : 'still there'))}, delete again ${again.ok ? 'ok' : again.failure}`;
  return checked('s6.4', gone.ok && again.ok, detail);
}

async function lifecycle(directory: Directory, rig: GoogleRig, deps: ProbeDeps, ou: string) {
  const address = `uwprobe${deps.suffix}@${rig.domain}`;
  const made = await inserted(directory, address, ou);
  if (made.id === null)
    return [made.result, ...WRITES.slice(1).map((id) => skipped(id, 'no probe user'))];
  return [
    made.result,
    await suspension(directory, made.id, address),
    await removal(directory, made.id, address),
  ];
}

export async function directoryProbes(deps: ProbeDeps): Promise<ProbeResult[]> {
  const rig = googleRig(deps);
  const ou = (deps.env['GOOGLE_ASSISTANT_OU'] ?? '').trim();
  if (typeof rig === 'string' || rig.admin === null || !ou.startsWith('/')) {
    const why = notConfigured(deps.env, SETTINGS);
    return [...READS, ...WRITES].map((id) => skipped(id, why));
  }
  const directory = googleDirectory({ tokens: rig.tokens, adminSubject: rig.admin });
  const reads = [
    await lookups(directory, rig, deps.suffix, rig.admin),
    await groupLookup(directory, rig, deps.suffix),
  ];
  if (!deps.write) return [...reads, ...WRITES.map((id) => skipped(id, WRITES_ONLY))];
  return [...reads, ...(await lifecycle(directory, rig, deps, ou))];
}
