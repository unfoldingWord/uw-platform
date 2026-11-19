import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { registerPage } from './page.ts';

const out = process.argv[2];
if (out === undefined) {
  console.error('Usage: pnpm github-apps:page <output.html>');
  process.exit(1);
}
writeFileSync(out, registerPage(randomUUID()));
console.log(`Wrote ${out}. Send it to the org owner who registers the Apps.`);
