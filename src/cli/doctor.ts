import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configForCommand, commandExists } from './common.js';
import { checkLocalPreflight } from '../config.js';
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
  const browserOnPath = (await Promise.all(['google-chrome', 'chromium', 'chromium-browser'].map(commandExists))).some(
    Boolean,
  );
  if (browserOnPath) report('Chrome/Chromium', true, 'available');
  else warn('Chrome/Chromium', 'not found on PATH; a configured OPENWA_BROWSER_PATH may still be valid');
  if (await commandExists('notify-send')) report('Desktop notifications', true, 'notify-send available');
  else
    warn(
      'Desktop notifications',
      'notify-send unavailable; alerts will still be written to logs/alerts.log and the journal',
    );
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
  try {
    await checkLocalPreflight(cfg);
    report('Local preflight', true, 'directories and configured browser are usable');
  } catch (error) {
    report('Local preflight', false, (error as Error).message);
  }
  if (cfg.gitSyncEnabled) {
    if (cfg.localOnlyMode)
      warn(
        'Git sync',
        'LOCAL_ONLY_MODE=true; automatic Git sync is disabled, manual npm run git:sync remains available',
      );
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
  if (await commandExists('systemctl')) {
    try {
      const unit = (
        await exec('systemctl', [
          '--user',
          'show',
          'placement-collector.service',
          '--property=ExecStart,WorkingDirectory,EnvironmentFiles',
        ])
      ).stdout;
      report(
        'systemd unit',
        unit.includes(cfg.codeRepoPath),
        unit.includes(cfg.codeRepoPath) ? 'matches this repository' : 'does not match this repository',
      );
    } catch {
      warn('systemd unit', 'not installed or user systemd is unavailable');
    }
    try {
      const timer = (
        await exec('systemctl', [
          '--user',
          'show',
          'placement-collector-watchdog.timer',
          '--property=LoadState,UnitFileState,ActiveState',
        ])
      ).stdout;
      const installed = !timer.includes('LoadState=not-found');
      if (installed) report('Watchdog timer', true, 'installed');
      else warn('Watchdog timer', 'not installed; rerun npm run systemd:install after building');
    } catch {
      warn('Watchdog timer', 'not installed or user systemd is unavailable');
    }
  }
  if (await commandExists('pm2')) warn('PM2', 'available; do not run PM2 and systemd collectors at the same time');
  console.log(`Messages today: ${await countToday(cfg)}`);
  if (cfg.healthEnabled) {
    try {
      const response = await fetch(`http://${cfg.healthHost}:${cfg.healthPort}/health`);
      if (response.ok) report('Health endpoint', true, `${response.status}`);
      else warn('Health endpoint', `${response.status}`);
    } catch {
      console.log('! Health endpoint: collector is not running');
    }
    try {
      const response = await fetch(`http://${cfg.healthHost}:${cfg.healthPort}/ready`);
      if (response.ok) report('Ready endpoint', true, `${response.status}`);
      else warn('Ready endpoint', `${response.status} (WhatsApp is not connected)`);
    } catch {
      warn('Ready endpoint', 'collector is not running');
    }
  }
  if (failed) process.exitCode = 1;
}
main().catch((error) => {
  console.error(`doctor failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
