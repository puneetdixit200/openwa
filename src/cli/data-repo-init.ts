import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { prompt, setEnvValues, commandExists } from './common.js';
import { runGit } from '../git.js';
async function main() {
  const rl = prompt();
  const destination = (await rl.question('Absolute path for the private raw-data repository: ')).trim();
  const name =
    (await rl.question('Private GitHub repository name [placement-raw-data]: ')).trim() || 'placement-raw-data';
  rl.close();
  if (!path.isAbsolute(destination)) throw new Error('use an absolute path');
  await fs.mkdir(destination, { recursive: true });
  try {
    await fs.access(path.join(destination, '.git'));
  } catch {
    await runGit(destination, ['init', '-b', 'main']);
  }
  await fs.mkdir(path.join(destination, 'incoming'), { recursive: true });
  await fs.writeFile(path.join(destination, '.gitignore'), 'runtime/\nlogs/\n.env\n.local-session/\n*.log\n');
  await fs.writeFile(
    path.join(destination, 'README.md'),
    '# Private placement raw data\n\nThis repository contains sensitive WhatsApp placement data. Keep it private.\n',
  );
  const status = await runGit(destination, ['status', '--porcelain']);
  if (status) {
    await runGit(destination, ['add', '--', '.gitignore', 'README.md', 'incoming']);
    await runGit(destination, [
      '-c',
      'user.name=Placement Collector',
      '-c',
      'user.email=collector@example.com',
      'commit',
      '-m',
      'chore: initialize private placement data repository',
    ]);
  }
  const hasRemote = await runGit(destination, ['remote'])
    .then((value) => Boolean(value.trim()))
    .catch(() => false);
  if (!hasRemote && (await commandExists('gh'))) {
    const answer = await (async () => {
      const ask = prompt();
      const result = await ask.question(`Create ${name} as a PRIVATE GitHub repository and push now? [y/N]: `);
      ask.close();
      return result.toLowerCase() === 'y';
    })();
    if (answer) {
      execFileSync(
        'gh',
        ['repo', 'create', name, '--private', '--source', destination, '--remote', 'origin', '--push'],
        { stdio: 'inherit' },
      );
    } else
      console.log(
        `No remote created. To create it later: gh repo create ${name} --private --source ${destination} --remote origin --push`,
      );
  } else if (!hasRemote)
    console.log(
      `GitHub CLI unavailable or no remote. Create a PRIVATE repository, then run: git -C ${destination} remote add origin git@github.com:USERNAME/${name}.git`,
    );
  await setEnvValues({
    DATA_REPOSITORY_PATH: destination,
    DATA_DIRECTORY: path.join(destination, 'incoming'),
    GIT_SYNC_ENABLED: 'false',
  });
  console.log(`Prepared ${destination}. Verify privacy and remote access, then set GIT_SYNC_ENABLED=true in .env.`);
}
main().catch((error) => {
  console.error(`data-repo:init failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
