import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { syncGit } from '../src/git.js';
import type { Config } from '../src/config.js';
const exec = promisify(execFile);
const git = async (cwd: string, args: string[]) => exec('git', args, { cwd });
const config = (root: string, repo: string) =>
  ({
    dataRepoPath: repo,
    runtimeDir: path.join(root, 'runtime'),
    gitSyncEnabled: true,
    gitRemote: 'origin',
    gitBranch: 'main',
    gitAuthorName: 'Test',
    gitAuthorEmail: 'test@example.com',
  }) as Config;
describe('private data git sync', () => {
  it('stages only incoming and reports no changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwa-git-'));
    const repo = path.join(root, 'data');
    const remote = path.join(root, 'remote.git');
    await fs.mkdir(repo);
    await git(repo, ['init', '-b', 'main']);
    await git(root, ['init', '--bare', remote]);
    await git(repo, ['remote', 'add', 'origin', remote]);
    await fs.mkdir(path.join(repo, 'incoming', '2026-08-04'), { recursive: true });
    await fs.writeFile(path.join(repo, 'incoming', '2026-08-04', 'messages.jsonl'), 'fake\n');
    await syncGit(config(root, repo));
    expect((await git(repo, ['status', '--short'])).stdout.trim()).toBe('');
    expect((await syncGit(config(root, repo))).status).toBe('no-changes');
  });
  it('refuses a lock collision', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwa-lock-'));
    const repo = path.join(root, 'data');
    await fs.mkdir(path.join(repo, '.git'), { recursive: true });
    await fs.mkdir(path.join(root, 'runtime', 'locks'), { recursive: true });
    await fs.writeFile(path.join(root, 'runtime', 'locks', 'git-sync.lock'), 'busy');
    await expect(syncGit(config(root, repo))).rejects.toThrow();
  });

  it('pushes an existing local commit even when there are no staged changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwa-pending-push-'));
    const repo = path.join(root, 'data');
    const remote = path.join(root, 'remote.git');
    await fs.mkdir(repo);
    await git(repo, ['init', '-b', 'main']);
    await git(root, ['init', '--bare', remote]);
    await git(repo, ['remote', 'add', 'origin', remote]);
    await fs.mkdir(path.join(repo, 'incoming', '2026-08-14'), { recursive: true });
    await fs.writeFile(path.join(repo, 'incoming', '2026-08-14', 'messages.jsonl'), 'first\n');
    await syncGit(config(root, repo));

    await fs.writeFile(path.join(repo, 'incoming', '2026-08-14', 'messages.jsonl'), 'first\nsecond\n');
    await git(repo, ['add', '--', 'incoming/']);
    await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'local only']);

    expect((await git(repo, ['status', '--short'])).stdout.trim()).toBe('');
    expect((await syncGit(config(root, repo))).status).toBe('success');
    expect((await git(repo, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(
      (await git(remote, ['rev-parse', 'main'])).stdout.trim(),
    );
  });
});
