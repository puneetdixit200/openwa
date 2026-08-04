import fs from 'node:fs/promises';
import { configForCommand } from './common.js';
import { readDay } from '../storage.js';
configForCommand()
  .then(async (cfg) => {
    const days = await fs.readdir(cfg.dataDir);
    for (const day of days.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))) await readDay(cfg, day);
    console.log(`valid: ${days.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).length} daily folders`);
  })
  .catch((error) => {
    console.error(`validate:data failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
