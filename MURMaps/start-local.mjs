#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = new Set(process.argv.slice(2));
const useProd = args.has('--prod');
const forceBuild = args.has('--build');
const noOpen = args.has('--no-open');

const majorNode = Number(process.versions.node.split('.')[0] || '0');
if (majorNode < 18) {
  console.error(
    `[MURS Карты] Требуется Node.js 18 или новее (установлена версия ${process.versions.node}).`
  );
  process.exit(1);
}

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function runCommand(cmd, cmdArgs, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: __dirname,
      stdio: 'inherit',
      shell: isWin,
      env: { ...process.env, ...extraEnv },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${cmdArgs.join(' ')} завершился с кодом ${code}`));
    });
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '0.0.0.0');
  });
}

async function findAvailablePort(startPort) {
  for (let p = startPort; p < startPort + 25; p++) {
    if (await isPortFree(p)) return p;
  }
  return startPort;
}

async function waitForServerReady(url, timeoutMs = 15000) {
  const healthUrl = `${url}/api/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) return true;
    } catch {
      // Server still booting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', shell: false }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Non-fatal if running headless or without xdg-open
  }
}

async function main() {
  const nodeModulesDir = path.join(__dirname, 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) {
    console.log('[MURS Карты] Установка зависимостей (npm install)...');
    await runCommand(npmCmd, ['install']);
  }

  const distDir = path.join(__dirname, 'dist');
  if (forceBuild || (useProd && !fs.existsSync(distDir))) {
    console.log('[MURS Карты] Сборка клиентского бандла (npm run build)...');
    await runCommand(npmCmd, ['run', 'build']);
  }

  const desiredPort = Number(process.env.PORT || 3000);
  const port = await findAvailablePort(desiredPort);
  if (port !== desiredPort) {
    console.log(`[MURS Карты] Порт ${desiredPort} занят — используется свободный порт ${port}.`);
  }

  const tsxCli = path.join(__dirname, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const serverEntry = path.join(__dirname, 'server.ts');
  const canRunTsxCli = fs.existsSync(tsxCli);

  const serverArgs = canRunTsxCli ? [tsxCli, serverEntry] : ['server.ts'];
  const execPath = canRunTsxCli ? process.execPath : isWin ? 'npx.cmd' : 'npx';
  const finalArgs = canRunTsxCli ? serverArgs : ['tsx', 'server.ts'];

  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: useProd ? 'production' : process.env.NODE_ENV || 'development',
  };

  const url = `http://localhost:${port}`;
  console.log(`[MURS Карты] Запуск локального сервера на ${url} (${process.platform})...`);

  const serverProc = spawn(execPath, finalArgs, {
    cwd: __dirname,
    stdio: 'inherit',
    shell: !canRunTsxCli && isWin,
    env,
  });

  if (!noOpen) {
    waitForServerReady(url).then((ready) => {
      if (ready && !serverProc.killed) {
        openBrowser(url);
      }
    });
  }

  const shutdown = (sig) => {
    if (!serverProc.killed) {
      serverProc.kill(sig);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  serverProc.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[MURS Карты] Ошибка запуска:', err instanceof Error ? err.message : err);
  process.exit(1);
});
