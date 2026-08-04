import { configForCommand } from './common.js';
import { syncGit } from '../git.js';
configForCommand()
  .then(syncGit)
  .then((result) => console.log(result))
  .catch((error) => {
    console.error(`git:sync failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
