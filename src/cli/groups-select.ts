import { createOpenWa, type GroupSummary, type OpenWaClient } from '../openwa.js';
import { checkLocalPreflight } from '../config.js';
import { acquireSessionLock } from '../session-lock.js';
import { assertBackgroundCollectorStopped, configForCommand, prompt, setEnvValues } from './common.js';
import { safeErrorMessage } from '../utils.js';

async function main() {
  const cfg = await configForCommand();
  await assertBackgroundCollectorStopped();
  await checkLocalPreflight(cfg);
  const lock = await acquireSessionLock(cfg.runtimeDir, 'groups-select');
  let client: OpenWaClient | undefined;
  try {
    client = await createOpenWa(cfg, { interactive: false, allowQr: false });
    const groups: GroupSummary[] = client.getAllGroups
      ? await client.getAllGroups(false)
      : ((await client.getAllChats?.()) ?? []).filter(
          (group: GroupSummary) => group.isGroup !== false && group.id.endsWith('@g.us'),
        );
    if (!groups.length) throw new Error('no WhatsApp groups found; confirm the account is connected and try again');
    groups.forEach((group, index) => console.log(`${index + 1}. ${group.name || '(unnamed)'}`));
    const rl = prompt();
    const answer = await rl.question('Select group numbers separated by commas: ');
    rl.close();
    const indexes = [...new Set(answer.split(',').map((value) => Number(value.trim()) - 1))];
    if (indexes.some((index) => !Number.isInteger(index) || !groups[index]))
      throw new Error('selection contains an out-of-range group number');
    if (!indexes.length) throw new Error('no groups selected');
    const chosen = indexes.map((index) => groups[index]);
    const confirm = prompt();
    const confirmation = await confirm.question(
      `Save ${chosen.length} selected groups to .env? Type YES to continue: `,
    );
    confirm.close();
    if (confirmation !== 'YES') throw new Error('group selection cancelled');
    await setEnvValues({ ALLOWED_GROUP_IDS: chosen.map((group) => group.id).join(','), ALLOWED_GROUP_NAMES: '' });
    console.log(`Selected ${chosen.length} groups:`);
    for (const group of chosen) console.log(`- ${group.name || '(unnamed)'}`);
  } finally {
    await client?.close?.().catch(() => {});
    await lock.release();
  }
}

main().catch((error) => {
  console.error(`groups:select failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
