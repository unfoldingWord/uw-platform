import { fileURLToPath } from 'node:url';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { simCommand } from '../runner/sim-command.ts';

const directory = fileURLToPath(new URL('../scenarios/', import.meta.url));

try {
  process.exitCode = await simCommand(process.argv.slice(2), directory, {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
} finally {
  await closeEmbeddedTemplate();
}
