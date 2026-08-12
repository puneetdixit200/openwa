import { createOpenWa, type GroupSummary, type OpenWaClient } from '../openwa.js';
import { checkLocalPreflight } from '../config.js';
import { acquireSessionLock } from '../session-lock.js';
import { assertBackgroundCollectorStopped, configForCommand, prompt } from './common.js';
import { safeErrorMessage } from '../utils.js';
const mask = (id: string) => (id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : '…');
async function main() {
  const cfg = await configForCommand();
  await assertBackgroundCollectorStopped();
  await checkLocalPreflight(cfg);
  const lock = await acquireSessionLock(cfg.runtimeDir, 'groups-list');
  let client: OpenWaClient | undefined;
  try {
    client = await createOpenWa(cfg, { interactive: false, allowQr: false });
    const groups = client.getAllGroups
      ? await client.getAllGroups(false)
      : ((await client.getAllChats?.()) ?? []).filter(
          (group: GroupSummary) => group.isGroup !== false && group.id.endsWith('@g.us'),
        );
    const full = process.argv.includes('--show-full-ids');
    if (full) {
      const rl = prompt();
      const answer = await rl.question('Print full group IDs to this terminal? Type YES to continue: ');
      rl.close();
      if (answer !== 'YES') throw new Error('full-ID output cancelled');
    }
    for (const group of groups)
      console.log(
        `${group.name || '(unnamed)'} | ${full ? group.id : mask(group.id)} | ${cfg.groupIds.includes(group.id) ? 'allowed' : 'ignored'}`,
      );
  } finally {
    await client?.close?.().catch(() => {});
    await lock.release();
  }
}
main().catch((error) => {
  console.error(`groups:list failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
