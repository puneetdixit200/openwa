import { configForCommand } from './common.js';
import { gitStatus } from '../git.js';
configForCommand()
  .then(gitStatus)
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(`git:status failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
