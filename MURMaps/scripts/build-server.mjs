import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const serverOutFile = path.join(distDir, 'server.mjs');

fs.mkdirSync(distDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(rootDir, 'server.ts')],
  outfile: serverOutFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

const indexHtml = path.join(distDir, 'index.html');
if (!fs.existsSync(indexHtml) || !fs.existsSync(serverOutFile)) {
  console.error('[MURMaps] Build verification failed: dist/index.html or dist/server.mjs missing.');
  process.exit(1);
}

console.log('[MURMaps] Portable production build ready (dist/index.html + dist/server.mjs).');
