import { createOpenWa, isAuthRequiredError, quarantineBaileysAuthState, type OpenWaClient } from '../openwa.js';
import { checkLocalPreflight, loadConfig, prepareLocalDirectories } from '../config.js';
import { acquireSessionLock } from '../session-lock.js';
import { assertBackgroundCollectorStopped } from './common.js';
import { safeErrorMessage } from '../utils.js';

async function main() {
  if (process.getuid?.() === 0) throw new Error('run npm run auth as your normal desktop user, not root');
  await assertBackgroundCollectorStopped();
  const cfg = loadConfig(process.cwd(), false);
  await prepareLocalDirectories(cfg);
  await checkLocalPreflight(cfg);
  const lock = await acquireSessionLock(cfg.runtimeDir, 'auth');
  let client: OpenWaClient | undefined;
  try {
    console.log('Starting WhatsApp authentication. Scan the QR shown in this terminal if prompted.');
    try {
      client = await createOpenWa(cfg, { interactive: true, allowQr: true });
    } catch (error) {
      if (!isAuthRequiredError(error)) throw error;
      await quarantineBaileysAuthState(cfg);
      console.log('The previous incomplete pairing was preserved locally. Generating a fresh QR.');
      client = await createOpenWa(cfg, { interactive: true, allowQr: true });
    }
    console.log('WhatsApp authentication succeeded.');
  } finally {
    await client?.close?.().catch(() => {});
    await lock.release();
  }
}

main().catch((error) => {
  console.error(`auth failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
