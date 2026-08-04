import { configForCommand } from './common.js';
import { rebuildManifest } from '../storage.js';
const day = process.argv[2];
if (!day) {
  console.error('usage: npm run repair:manifest -- YYYY-MM-DD');
  process.exit(1);
}
configForCommand()
  .then((cfg) => rebuildManifest(cfg, day))
  .then((manifest) =>
    console.log(`repaired ${day}: ${manifest.messageCount} messages; old manifest backed up when present`),
  )
  .catch((error) => {
    console.error(`repair:manifest failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
