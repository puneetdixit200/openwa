import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';
export function runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  return new Promise<string>((resolve, reject) => {
    const p = spawn('git', args, { cwd, env: { ...process.env, ...env } });
    let out = '',
      err = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `git exited ${code}`))));
  });
}
export async function gitCheck(cfg: Config) {
  const repo = cfg.dataRepoPath;
  await runGit(repo, ['rev-parse', '--show-toplevel']);
  const remoteUrl = await runGit(repo, ['remote', 'get-url', cfg.gitRemote]);
  const branch = await runGit(repo, ['branch', '--show-current']);
  if (branch !== cfg.gitBranch) throw new Error(`data repository is on '${branch}', expected '${cfg.gitBranch}'`);
  return { repo, remoteUrl, branch };
}
function forbidden(file: string) {
  return /(^|\/)(\.env|\.local-session|runtime|logs|node_modules|tokens|credentials|session-data)(\/|$)|(^|\/)\.(.*token|.*secret)/i.test(
    file,
  );
}

async function remoteBranchHead(cfg: Config) {
  const output = await runGit(cfg.dataRepoPath, ['ls-remote', '--heads', cfg.gitRemote, `refs/heads/${cfg.gitBranch}`]);
  return output.split(/\s+/)[0] || null;
}

function rejectForbiddenFiles(files: string[], context: string) {
  const unsafe = files.find(forbidden);
  if (unsafe) throw new Error(`refusing ${context} containing forbidden file: ${unsafe}`);
}

export async function syncGit(cfg: Config) {
  if (!cfg.gitSyncEnabled) return { status: 'disabled' };
  const lock = path.join(cfg.runtimeDir, 'locks', 'git-sync.lock');
  await fs.mkdir(path.dirname(lock), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lock, 'wx');
    await gitCheck(cfg);
    await runGit(cfg.dataRepoPath, ['add', '--', 'incoming/']);
    const staged = (await runGit(cfg.dataRepoPath, ['diff', '--cached', '--name-only'])).split('\n').filter(Boolean);
    if (staged.some((file) => !file.startsWith('incoming/') || forbidden(file)))
      throw new Error(
        `refusing unsafe staged file: ${staged.find((file) => !file.startsWith('incoming/') || forbidden(file))}`,
      );
    if (staged.length) {
      const dates = staged
        .map((file) => file.match(/^incoming\/(\d{4}-\d{2}-\d{2})/)?.[1])
        .filter((x): x is string => Boolean(x));
      const through = dates.sort().at(-1) ?? 'today';
      await runGit(cfg.dataRepoPath, [
        '-c',
        `user.name=${cfg.gitAuthorName}`,
        '-c',
        `user.email=${cfg.gitAuthorEmail}`,
        'commit',
        '-m',
        `data: sync placement messages through ${through}`,
      ]);
    }

    await runGit(cfg.dataRepoPath, ['fetch', cfg.gitRemote]);
    const remoteHeadBefore = await remoteBranchHead(cfg);
    const remoteHasBranch = remoteHeadBefore !== null;
    if (remoteHasBranch)
      try {
        await runGit(cfg.dataRepoPath, ['pull', '--rebase', cfg.gitRemote, cfg.gitBranch]);
      } catch (e) {
        await runGit(cfg.dataRepoPath, ['rebase', '--abort']).catch(() => {});
        throw new Error(`safe rebase failed; resolve conflicts in ${cfg.dataRepoPath}: ${(e as Error).message}`);
      }

    const localHead = await runGit(cfg.dataRepoPath, ['rev-parse', 'HEAD']);
    if (remoteHasBranch) {
      const pendingFiles = (
        await runGit(cfg.dataRepoPath, ['diff', '--name-only', `${cfg.gitRemote}/${cfg.gitBranch}..HEAD`])
      )
        .split('\n')
        .filter(Boolean);
      rejectForbiddenFiles(pendingFiles, 'push');
    } else {
      const trackedFiles = (await runGit(cfg.dataRepoPath, ['ls-files'])).split('\n').filter(Boolean);
      rejectForbiddenFiles(trackedFiles, 'initial push');
    }

    const pushNeeded = remoteHeadBefore !== localHead;
    if (pushNeeded) await runGit(cfg.dataRepoPath, ['push', cfg.gitRemote, `HEAD:${cfg.gitBranch}`]);

    const verifiedRemoteHead = await remoteBranchHead(cfg);
    if (verifiedRemoteHead !== localHead)
      throw new Error(`push verification failed: ${cfg.gitRemote}/${cfg.gitBranch} does not match local HEAD`);

    return { status: staged.length || pushNeeded ? 'success' : 'no-changes', files: staged };
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(lock).catch(() => {});
  }
}
export async function gitStatus(cfg: Config) {
  await gitCheck(cfg);
  const porcelain = await runGit(cfg.dataRepoPath, ['status', '--short']);
  return { repo: cfg.dataRepoPath, changes: porcelain ? porcelain.split('\n') : [] };
}

export async function pendingGitFileCount(cfg: Config) {
  try {
    const status = await runGit(cfg.dataRepoPath, ['status', '--short', '--', 'incoming/']);
    return status ? status.split('\n').filter(Boolean).length : 0;
  } catch {
    return 0;
  }
}
