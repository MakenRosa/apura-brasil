import { spawnSync } from 'node:child_process';

export function verifyManagedProcess(pid, server) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Identificador de processo inválido.');
  const check = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-Command', "$ErrorActionPreference = 'Stop'; $apuraProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $env:APURA_VERIFY_PID); if (!$apuraProcess) { Write-Output 'missing' } elseif ($apuraProcess.Name -eq 'node.exe' -and $apuraProcess.CommandLine -and $apuraProcess.CommandLine.Contains($env:APURA_VERIFY_SERVER)) { Write-Output 'owned' } else { Write-Output 'foreign' }"], { encoding:'utf8', windowsHide:true, env:{...process.env, APURA_VERIFY_PID:String(pid), APURA_VERIFY_SERVER:server} })
    : spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding:'utf8' });
  if (check.error || (check.status !== 0 && !(process.platform !== 'win32' && check.status === 1))) {
    throw new Error('Não foi possível verificar o processo. O registro foi preservado; execute este comando no terminal do seu usuário.');
  }
  return process.platform === 'win32'
    ? check.stdout.trim() === 'owned'
    : check.stdout.trim().includes(server);
}
