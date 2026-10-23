import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verifyManagedProcess } from './managed-process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4178);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT deve estar entre 1024 e 65535.');
const url = `http://127.0.0.1:${port}`;
const dataDir = path.join(root, 'data');
mkdirSync(dataDir, { recursive: true });

async function health() {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    const body = await response.json();
    return body.service === 'apura-brasil' && body.ok ? body : null;
  } catch { return null; }
}

function openBrowser() {
  if (process.argv.includes('--no-open')) return;
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const browser = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  browser.on('error', () => console.log(`Abra o navegador em ${url}`));
  browser.unref();
}

const existing = await health();
if (existing) {
  try {
    const server = path.join(root, 'server', 'index.mjs');
    if (verifyManagedProcess(existing.pid, server)) {
      writeFileSync(path.join(dataDir, 'runtime.json'), JSON.stringify({pid:existing.pid, port, server, startedAt:new Date().toISOString()}, null, 2));
    }
  } catch (error) { console.log(error.message); }
  console.log(`Apura Brasil já está aberto em ${url}`);
  openBrowser();
} else {
  if (!existsSync(path.join(root, 'node_modules', 'vite'))) {
    console.error('Dependências ausentes. Execute npm ci nesta pasta e tente novamente.');
    process.exit(1);
  }
  if (!existsSync(path.join(root, 'dist', 'index.html'))) {
    console.log('Compilando Apura Brasil...');
    const build = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: root, stdio: 'inherit', windowsHide: true });
    if (build.status !== 0) process.exit(build.status || 1);
    const bundle = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, stdio: 'inherit', windowsHide: true });
    if (bundle.status !== 0) process.exit(bundle.status || 1);
  }
  const logPath = path.join(dataDir, 'server.log');
  const log = openSync(logPath, 'a');
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.mjs')], { cwd: root, detached: true, stdio: ['ignore', log, log], windowsHide: true, env: { ...process.env, PORT: String(port) } });
  closeSync(log);
  let launchError = null;
  child.on('error', error => { launchError = error; });
  child.unref();
  let live = null;
  for (let attempt = 0; attempt < 30 && !live && !launchError; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 350));
    live = await health();
  }
  if (!live || launchError || live.pid !== child.pid) {
    console.error(`Não foi possível iniciar Apura Brasil na porta ${port}. Consulte ${logPath}.`);
    console.error(readFileSync(logPath, 'utf8').slice(-1800));
    process.exit(1);
  }
  writeFileSync(path.join(dataDir, 'runtime.json'), JSON.stringify({ pid: child.pid, port, server: path.join(root, 'server', 'index.mjs'), startedAt: new Date().toISOString() }, null, 2));
  console.log(`Apura Brasil disponível em ${url}`);
  console.log('Para encerrar: npm run stop ou encerrar.cmd.');
  openBrowser();
}
