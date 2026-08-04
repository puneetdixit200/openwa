import { configForCommand } from './common.js';
import { gitCheck } from '../git.js';
configForCommand()
  .then(gitCheck)
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(`git:check failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
