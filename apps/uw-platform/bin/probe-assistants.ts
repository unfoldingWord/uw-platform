import { readFileSync } from 'node:fs';
import { probeMain } from './probe-assistants-cli.ts';

const code = await probeMain(process.argv.slice(2), {
  env: process.env,
  readFile: (path) => readFileSync(path, 'utf8'),
  fetcher: fetch,
  print: (line) => console.log(line),
  now: () => new Date(),
});
process.exit(code);
