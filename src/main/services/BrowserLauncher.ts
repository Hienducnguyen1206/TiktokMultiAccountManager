import { EventEmitter } from 'events'
import { openBrowsing, closeSession, engineEvents } from './ShardEngine'
import { ProfileStore } from './ProfileStore'
import { cleanProfileCache } from './cacheCleaner'
import { trackProc } from './EngineProcs'

export const launcherEvents = new EventEmitter()

/**
 * Launch a profile for manual browsing via ShardEngine. No CDP is enabled so
 * there is no automation footprint.
 */
export async function runProfile(id: string): Promise<void> {
  const profile = ProfileStore.get(id)
  if (!profile) throw new Error('Không tìm thấy profile')

  // ShardEngine.launch() already guards against opening the same profile
  // twice — it checks its internal sessions/launching maps synchronously
  // (before any await) and throws a Vietnamese error if the profile is
  // already open. Do NOT re-check isRunning() here: that would just be a
  // second place holding the same condition, which can drift out of sync
  // with the first. Let the error from ShardEngine propagate to the caller.
  const session = await openBrowsing(profile)
  trackProc(session.process)

  ProfileStore.setRunning(id, true)
  ProfileStore.markLastUsed(id)
  launcherEvents.emit('status', id, 'running')

  // Reset back to idle exactly once, however the session ends: a normal
  // 'exit' on session.process, OR ShardEngine's 'process-error' signal (its
  // own launch() emits this when session.process gets an 'error' instead of
  // — or possibly in addition to, Node does not guarantee otherwise — 'exit'
  // when spawn fails at the OS level; see ShardEngine.ts for the full
  // explanation). Without also handling the second case, this profile would
  // stay stuck showing "running" forever with no way to recover except
  // restarting the app, since nothing would ever call setRunning(false).
  let settled = false
  const resetToIdle = (): void => {
    if (settled) return
    settled = true
    engineEvents.off('process-error', onProcessError)
    ProfileStore.setRunning(id, false)
    launcherEvents.emit('status', id, 'idle')
    // Browser thủ công đã đóng → dọn cache profile (giữ cookie/login).
    cleanProfileCache(session.userDataDir)
  }
  // engineEvents is shared by every profile session, not scoped to this one
  // — filter by id, and unsubscribe in resetToIdle() above so this listener
  // doesn't accumulate forever across many opens over the app's lifetime.
  function onProcessError(profileId: string): void {
    if (profileId === id) resetToIdle()
  }
  engineEvents.on('process-error', onProcessError)

  session.process.on('exit', resetToIdle)
}

export async function stopProfile(id: string): Promise<void> {
  await closeSession(id)
}
