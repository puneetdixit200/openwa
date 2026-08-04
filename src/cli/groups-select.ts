import { createOpenWa, type GroupSummary } from '../openwa.js';
import { configForCommand, prompt, setEnvValues } from './common.js';
async function main() {
  const cfg = await configForCommand();
  const client = await createOpenWa(cfg);
  try {
    const groups = client.getAllGroups
      ? await client.getAllGroups(false)
      : ((await client.getAllChats?.()) ?? []).filter(
          (group: GroupSummary) => group.isGroup !== false && group.id.endsWith('@g.us'),
        );
    if (!groups.length) {
      throw new Error('no WhatsApp groups found; confirm the account is connected and try again');
    }
    groups.forEach((group, index) => console.log(`${index + 1}. ${group.name || '(unnamed)'}`));
    const rl = prompt();
    const answer = await rl.question('Select group numbers separated by commas: ');
    rl.close();
    const selected = answer
      .split(',')
      .map((value) => Number(value.trim()) - 1)
      .filter((index) => Number.isInteger(index) && groups[index]);
    if (!selected.length) throw new Error('no valid groups selected');
    const chosen = selected.map((index) => groups[index]);
    await setEnvValues({ ALLOWED_GROUP_IDS: chosen.map((group) => group.id).join(','), ALLOWED_GROUP_NAMES: '' });
    console.log(`Selected: ${chosen.map((group) => group.name || '(unnamed)').join(', ')}`);
  } finally {
    await client.close?.();
  }
}
main().catch((error) => {
  console.error(`groups:select failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
