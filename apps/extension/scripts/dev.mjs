import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = [...argv];
  const flags = new Set(args);

  const browser = flags.has('--firefox') ? 'firefox' : 'chrome';

  const modeIdx = args.findIndex((arg) => arg === '--mode');
  const mode = modeIdx >= 0 && typeof args[modeIdx + 1] === 'string' ? args[modeIdx + 1] : 'development';

  return { browser, mode };
}

function spawnBunx(args, env) {
  return spawn('bunx', args, {
    cwd: packageRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });
}

function main() {
  const { browser, mode } = parseArgs(process.argv.slice(2));
  const env = { ...process.env, VITE_BROWSER: browser };

  const children = [
    spawnBunx(['vite', 'build', '--watch', '--mode', mode], env),
    spawnBunx(['vite', 'build', '--watch', '-c', 'vite.config.content.ts', '--mode', mode], env),
  ];

  let shuttingDown = false;

  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
    process.exit(code);
  };

  for (const child of children) {
    child.on('exit', (code) => {
      if (shuttingDown) return;
      shutdown(typeof code === 'number' ? code : 1);
    });
  }

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
}

main();

