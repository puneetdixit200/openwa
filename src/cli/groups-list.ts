import { createOpenWa, type GroupSummary } from '../openwa.js';
import { configForCommand, prompt } from './common.js';
const mask = (id: string) => (id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : '…');
async function main() {
  const cfg = await configForCommand();
  const client = await createOpenWa(cfg);
  try {
    const groups = ((await client.getAllChats?.()) ?? []).filter(
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
    await client.close?.();
  }
}
main().catch((error) => {
  console.error(`groups:list failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
