import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verifyManagedProcess } from './managed-process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimePath = path.join(root, 'data', 'runtime.json');
if (!existsSync(runtimePath)) {
  console.log('Nenhuma execução gerenciada encontrada. Em um terminal com npm start, use Ctrl+C.');
  process.exit(0);
}
const runtime = JSON.parse(readFileSync(runtimePath, 'utf8'));
const server = path.join(root, 'server', 'index.mjs');
if (!Number.isInteger(runtime.pid) || runtime.pid <= 0 || path.resolve(runtime.server) !== path.resolve(server)) throw new Error('Registro de execução inválido.');
let owned;
try { owned = verifyManagedProcess(runtime.pid, server); }
catch (error) { console.error(error.message); process.exit(1); }
if (!owned) {
  console.log('O processo registrado não corresponde a esta aplicação ou já foi encerrado. Nenhum processo foi alterado.');
  unlinkSync(runtimePath);
  process.exit(0);
}
process.kill(runtime.pid, 'SIGTERM');
unlinkSync(runtimePath);
console.log('Apura Brasil encerrado. O histórico local foi preservado.');
