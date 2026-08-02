import type { ChildProcess } from 'child_process'

// Sổ theo dõi mọi tiến trình engine (ShardX Chromium) đã spawn — để kill
// sạch khi thoát app, tránh orphan process giữ khóa profile (gây EBUSY lần sau).
const procs = new Set<ChildProcess>()

export function trackProc(p: ChildProcess): void {
  procs.add(p)
  p.once('exit', () => procs.delete(p))
}

export function killAllProcs(): void {
  for (const p of procs) {
    try {
      p.kill()
    } catch {
      /* ignore */
    }
  }
  procs.clear()
}
