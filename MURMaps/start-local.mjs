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
const forceReinstall = args.has('--reinstall');
const noOpen = args.has('--no-open');

const majorNode = Number(process.versions.node.split('.')[0] || '0');
if (majorNode < 18) {
  console.error(
    `[MURMaps] Требуется Node.js 18 или новее (установлена версия ${process.versions.node}).`
  );
  process.exit(1);
}

const isWin = process.platform === 'win32';
const currentPlatformKey = `${process.platform}-${process.arch}`;

/**
 * Checks whether `node_modules` is missing, incomplete, or contains native binaries
 * installed on a different operating system / CPU architecture (for example, Linux
 * `@esbuild/linux-x64` or `@rolldown/binding-linux-x64-gnu` inside an archive opened on Windows).
 */
export function inspectNodeModulesState(
  nodeModulesDir,
  platform = process.platform,
  arch = process.arch
) {
  if (!fs.existsSync(nodeModulesDir)) {
    return { status: 'missing', reason: 'Папка node_modules отсутствует' };
  }

  const platformKey = `${platform}-${arch}`;
  const markerFile = path.join(nodeModulesDir, '.murmaps-platform');
  if (fs.existsSync(markerFile)) {
    try {
      const saved = fs.readFileSync(markerFile, 'utf8').trim();
      if (saved && saved !== platformKey) {
        return {
          status: 'platform-mismatch',
          reason: `Зависимости установлены для ${saved}, а текущая система — ${platformKey}`,
        };
      }
    } catch {
      // Ignore unreadable marker and fall through to native binary checks
    }
  }

  // 1. Check @esbuild native binary (required by tsx & vite)
  const esbuildScope = path.join(nodeModulesDir, '@esbuild');
  if (fs.existsSync(esbuildScope)) {
    try {
      const entries = fs.readdirSync(esbuildScope);
      if (entries.length > 0 && !entries.includes(platformKey)) {
        return {
          status: 'platform-mismatch',
          reason: `Обнаружен @esbuild/${entries[0]} вместо @esbuild/${platformKey}`,
        };
      }
    } catch {
      // Ignore read errors
    }
  }

  // 2. Check @rolldown native bindings (required by Vite 8)
  const rolldownScope = path.join(nodeModulesDir, '@rolldown');
  if (fs.existsSync(rolldownScope)) {
    try {
      const bindings = fs
        .readdirSync(rolldownScope)
        .filter((name) => name.startsWith('binding-'));
      if (
        bindings.length > 0 &&
        !bindings.some((name) => name.startsWith(`binding-${platformKey}`))
      ) {
        return {
          status: 'platform-mismatch',
          reason: `Обнаружен @rolldown/${bindings[0]} вместо binding-${platformKey}`,
        };
      }
    } catch {
      // Ignore read errors
    }
  }

  // 3. Check @tailwindcss oxide native bindings (ignore universal wasm32 fallback)
  const tailwindScope = path.join(nodeModulesDir, '@tailwindcss');
  if (fs.existsSync(tailwindScope)) {
    try {
      const oxides = fs
        .readdirSync(tailwindScope)
        .filter((name) => name.startsWith('oxide-') && !name.includes('wasm'));
      if (oxides.length > 0 && !oxides.some((name) => name.startsWith(`oxide-${platformKey}`))) {
        return {
          status: 'platform-mismatch',
          reason: `Обнаружен @tailwindcss/${oxides[0]} вместо oxide-${platformKey}`,
        };
      }
    } catch {
      // Ignore read errors
    }
  }

  // 4. Verify core runtime packages exist
  const requiredFiles = [
    path.join(nodeModulesDir, 'express', 'package.json'),
    path.join(nodeModulesDir, 'vite', 'package.json'),
    path.join(nodeModulesDir, 'tsx', 'dist', 'cli.mjs'),
  ];
  for (const reqFile of requiredFiles) {
    if (!fs.existsSync(reqFile)) {
      return {
        status: 'incomplete',
        reason: `Не хватает обязательного пакета (${path.relative(nodeModulesDir, reqFile)})`,
      };
    }
  }

  return { status: 'ok', reason: '' };
}

function runNpm(npmArgs, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = isWin
      ? spawn('cmd.exe', ['/d', '/s', '/c', `npm ${npmArgs.join(' ')}`], {
          cwd: __dirname,
          stdio: 'inherit',
          shell: false,
          env: { ...process.env, ...extraEnv },
        })
      : spawn('npm', npmArgs, {
          cwd: __dirname,
          stdio: 'inherit',
          shell: false,
          env: { ...process.env, ...extraEnv },
        });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${npmArgs.join(' ')} завершился с кодом ${code}`));
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

async function waitForServerReady(url, timeoutMs = 20000) {
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
      spawn('cmd.exe', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        shell: false,
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Non-fatal if running headless or without xdg-open
  }
}

async function ensureNativeDependencies(nodeModulesDir) {
  const state = forceReinstall
    ? { status: 'platform-mismatch', reason: 'Запрошена переустановка (--reinstall)' }
    : inspectNodeModulesState(nodeModulesDir);

  if (state.status === 'ok') {
    const markerFile = path.join(nodeModulesDir, '.murmaps-platform');
    if (!fs.existsSync(markerFile)) {
      try {
        fs.writeFileSync(markerFile, `${currentPlatformKey}\n`, 'utf8');
      } catch {
        // Non-fatal
      }
    }
    return;
  }

  if (state.status === 'platform-mismatch') {
    console.log(`[MURMaps] ${state.reason}.`);
    console.log(
      `[MURMaps] Очистка зависимостей от другой ОС и переустановка для ${currentPlatformKey}...`
    );
    fs.rmSync(nodeModulesDir, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 250,
    });
  } else {
    console.log(`[MURMaps] ${state.reason}. Установка зависимостей (npm install)...`);
  }

  await runNpm(['install', '--no-audit', '--no-fund']);

  try {
    fs.writeFileSync(path.join(nodeModulesDir, '.murmaps-platform'), `${currentPlatformKey}\n`, 'utf8');
  } catch {
    // Non-fatal
  }
}

async function main() {
  const nodeModulesDir = path.join(__dirname, 'node_modules');
  await ensureNativeDependencies(nodeModulesDir);

  const distDir = path.join(__dirname, 'dist');
  if (forceBuild || (useProd && !fs.existsSync(distDir))) {
    console.log('[MURMaps] Сборка клиентского бандла (npm run build)...');
    await runNpm(['run', 'build']);
  }

  const desiredPort = Number(process.env.PORT || 3000);
  const port = await findAvailablePort(desiredPort);
  if (port !== desiredPort) {
    console.log(`[MURMaps] Порт ${desiredPort} занят — используется свободный порт ${port}.`);
  }

  const tsxCli = path.join(__dirname, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const serverEntry = path.join(__dirname, 'server.ts');
  const canRunTsxCli = fs.existsSync(tsxCli);

  const execPath = canRunTsxCli
    ? process.execPath
    : isWin
    ? 'cmd.exe'
    : 'npx';
  const finalArgs = canRunTsxCli
    ? [tsxCli, serverEntry]
    : isWin
    ? ['/d', '/s', '/c', 'npx tsx server.ts']
    : ['tsx', 'server.ts'];

  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: useProd ? 'production' : process.env.NODE_ENV || 'development',
  };

  const url = `http://localhost:${port}`;
  console.log(`[MURMaps] Запуск локального сервера на ${url} (${currentPlatformKey})...`);

  const serverProc = spawn(execPath, finalArgs, {
    cwd: __dirname,
    stdio: 'inherit',
    shell: false,
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

const isDirectEntry =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectEntry) {
  main().catch((err) => {
    console.error('[MURMaps] Ошибка запуска:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
