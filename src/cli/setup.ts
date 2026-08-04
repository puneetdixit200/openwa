import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { prompt, setEnvValues } from './common.js';
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${name}: ${detail}`);
  return ok;
}
async function main() {
  console.log('Local WhatsApp Placement Collector setup');
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  check('Node.js', nodeMajor >= 20, process.versions.node);
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    check('Git', true, 'available');
  } catch {
    check('Git', false, 'install Git before continuing');
  }
  const chrome = ['google-chrome', 'chromium', 'chromium-browser'].find((name) => {
    try {
      execFileSync('sh', ['-lc', `command -v ${name}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });
  check('Chrome/Chromium', Boolean(chrome), chrome ?? 'not found');
  try {
    await fs.access(path.join(process.cwd(), '.git'));
    check('Code repository', true, process.cwd());
  } catch {
    throw new Error('run npm run setup from the cloned code repository');
  }
  const example = await fs.readFile(path.join(process.cwd(), '.env.example'), 'utf8');
  let created = false;
  try {
    await fs.access('.env');
    const current = await fs.readFile('.env', 'utf8');
    if (/^HASH_SALT=replace-with-/m.test(current)) {
      await fs.writeFile(
        '.env',
        current.replace(/^HASH_SALT=.*$/m, `HASH_SALT=${crypto.randomBytes(32).toString('hex')}`),
        { mode: 0o600 },
      );
      console.log('Generated a random hash salt in the template .env.');
    } else console.log('! .env exists; preserving it without overwrite');
  } catch {
    const salt = crypto.randomBytes(32).toString('hex');
    await fs.writeFile('.env', example.replace(/^HASH_SALT=.*$/m, `HASH_SALT=${salt}`), { mode: 0o600 });
    created = true;
    console.log('Created .env with a random 32-byte hash salt.');
  }
  const rl = prompt();
  const destination = (
    await rl.question(`Private raw-data repository path${created ? '' : ' (leave blank to preserve current value)'}: `)
  ).trim();
  rl.close();
  if (destination)
    await setEnvValues({ DATA_REPOSITORY_PATH: destination, DATA_DIRECTORY: path.join(destination, 'incoming') });
  try {
    await fs.chmod('.env', 0o600);
  } catch {
    /* platform without chmod */
  }
  console.log(
    '\nNext: npm run data-repo:init, npm run groups:select, npm run doctor, npm run dev. Setup never sends WhatsApp messages.',
  );
}
main().catch((error) => {
  console.error(`setup failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
