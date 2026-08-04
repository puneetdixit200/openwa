import { configForCommand } from './common.js';
import { readDay } from '../storage.js';
const day = process.argv[2];
if (!day) {
  console.error('usage: npm run validate:day -- YYYY-MM-DD');
  process.exit(1);
}
configForCommand()
  .then((cfg) => readDay(cfg, day))
  .then(({ messages }) => console.log(`valid: ${day} (${messages.length} messages)`))
  .catch((error) => {
    console.error(`validate:day failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
