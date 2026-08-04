import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig } from '../config.js';
export const prompt = () => createInterface({ input, output });
export async function setEnvValues(values: Record<string, string>) {
  const file = path.join(process.cwd(), '.env');
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    text = await fs.readFile(path.join(process.cwd(), '.env.example'), 'utf8');
  }
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  }
  await fs.writeFile(file, text, { mode: 0o600 });
  try {
    await fs.chmod(file, 0o600);
  } catch {
    /* Windows does not expose POSIX permissions */
  }
}
export async function configForCommand() {
  return loadConfig(process.cwd(), false);
}
export async function gitAvailable() {
  try {
    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => execFile('git', ['--version'], (e) => (e ? reject(e) : resolve())));
    return true;
  } catch {
    return false;
  }
}
export async function commandExists(command: string) {
  try {
    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) =>
      execFile('sh', ['-lc', `command -v ${command}`], (e) => (e ? reject(e) : resolve())),
    );
    return true;
  } catch {
    return false;
  }
}
