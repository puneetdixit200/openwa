import { configForCommand } from './common.js';
import { countToday, dateFolder } from '../storage.js';
configForCommand()
  .then(async (cfg) =>
    console.log(
      JSON.stringify(
        {
          dataRepositoryPath: cfg.dataRepoPath,
          dataDirectory: cfg.dataDir,
          currentDailyFolder: await dateFolder(cfg),
          messagesStoredToday: await countToday(cfg),
          health: `http://${cfg.healthHost}:${cfg.healthPort}`,
        },
        null,
        2,
      ),
    ),
  )
  .catch((error) => {
    console.error(`status failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
