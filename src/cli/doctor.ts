import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configForCommand, commandExists } from './common.js';
import { gitCheck } from '../git.js';
import { countToday } from '../storage.js';
const exec = promisify(execFile);
let failed = false;
function report(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${name}: ${detail}`);
  if (!ok) failed = true;
}
function warn(name: string, detail: string) {
  console.log(`! ${name}: ${detail}`);
}
async function main() {
  report('Node.js', Number(process.versions.node.split('.')[0]) >= 20, process.versions.node);
  report('Git', await commandExists('git'), 'available');
  if (
    await Promise.any(['google-chrome', 'chromium', 'chromium-browser'].map(commandExists))
      .then(() => true)
      .catch(() => false)
  )
    report('Chrome/Chromium', true, 'available');
  else warn('Chrome/Chromium', 'not found; install Chrome or Chromium before QR authentication');
  let cfg;
  try {
    cfg = await configForCommand();
    report('Configuration', true, 'valid');
  } catch (error) {
    report('Configuration', false, (error as Error).message);
    process.exitCode = 1;
    return;
  }
  report(
    'Group allowlist',
    cfg.groupIds.length > 0 || cfg.groupNames.length > 0,
    cfg.groupIds.length > 0 ? 'exact group IDs configured' : 'select a group before starting collection',
  );
  for (const [name, file] of [
    ['session directory', cfg.sessionDirectory],
    ['runtime directory', cfg.runtimeDir],
    ['logs directory', cfg.logDir],
    ['data directory', cfg.dataDir],
  ] as const) {
    try {
      await fs.mkdir(file, { recursive: true });
      await fs.access(file);
      report(name, true, file);
    } catch (error) {
      report(name, false, (error as Error).message);
    }
  }
  if (cfg.gitSyncEnabled) {
    try {
      const result = await gitCheck(cfg);
      report('Data Git repository', true, `${result.branch} ${result.remoteUrl}`);
      if (await commandExists('gh')) {
        try {
          const remote = result.remoteUrl.replace(/^git@github.com:/, 'https://github.com/').replace(/\.git$/, '');
          const privacy = JSON.parse((await exec('gh', ['repo', 'view', remote, '--json', 'isPrivate'])).stdout);
          report('GitHub privacy', privacy.isPrivate, 'private');
        } catch {
          report('GitHub privacy', false, 'could not verify with gh');
        }
      } else console.log('! GitHub privacy: gh unavailable; verify manually.');
    } catch (error) {
      report('Data Git repository', false, (error as Error).message);
    }
  }
  if (await commandExists('pm2')) report('PM2', true, 'available');
  else warn('PM2', 'not installed; development mode remains available');
  console.log(`Messages today: ${await countToday(cfg)}`);
  if (cfg.healthEnabled) {
    try {
      const response = await fetch(`http://${cfg.healthHost}:${cfg.healthPort}/health`);
      if (response.ok) report('Health endpoint', true, `${response.status}`);
      else warn('Health endpoint', `${response.status}`);
    } catch {
      console.log('! Health endpoint: collector is not running');
    }
  }
  if (failed) process.exitCode = 1;
}
main().catch((error) => {
  console.error(`doctor failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
