import { useEffect, useMemo, useState } from 'react'
import { Flag } from '../../components/Flag'
import { timeAgo } from '../../lib/format'
import { NewProfileDialog } from './NewProfileDialog'
import { ProfileSettingsDialog } from './ProfileSettingsDialog'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { showToast } from '../../components/uiDialogs'
import type { Group, MachineIp, Profile } from '@shared/types'

function WarningFlags({ level }: { level: number }): JSX.Element {
  return (
    <span className="whitespace-nowrap">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= level ? '' : 'opacity-20 grayscale'}>
          🚩
        </span>
      ))}
    </span>
  )
}

export function ProfileTab({
  profiles,
  groups,
  machineIp,
  onReload,
  onRefreshIp
}: {
  profiles: Profile[]
  groups: Group[]
  machineIp: MachineIp | null
  onReload: () => void
  onRefreshIp: () => void
}): JSX.Element {
  const [q, setQ] = useState('')
  const [sortBy, setSortBy] = useState<'default' | 'name' | 'lastUsed'>('default')
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [togglingLogin, setTogglingLogin] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState<string | null>(null)
  const [loginMsg, setLoginMsg] = useState<Record<string, string>>({})
  const [confirmingDelAll, setConfirmingDelAll] = useState(false)
  const [syncingAll, setSyncingAll] = useState(false)
  // Tiến trình tải engine ShardX. Lần chạy đầu (và mỗi lần engine tự cập nhật
  // theo manifest) việc tải vài trăm MB xảy ra BÊN TRONG lệnh mở profile, nên
  // không có dòng này thì nút "Mở" đứng im nhiều phút và app trông như bị treo.
  const [engineProgress, setEngineProgress] = useState<{ phase: string; pct: number } | null>(null)

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    const filtered = t
      ? profiles.filter(
          (p) => p.name.toLowerCase().includes(t) || (p.groupName ?? '').toLowerCase().includes(t)
        )
      : profiles
    if (sortBy === 'default') return filtered
    const arr = [...filtered]
    if (sortBy === 'name') {
      arr.sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    } else if (sortBy === 'lastUsed') {
      // mới truy cập nhất lên đầu; chưa từng dùng (null) xuống cuối
      arr.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    }
    return arr
  }, [profiles, q, sortBy])

  const run = async (p: Profile): Promise<void> => {
    setBusy(p.id)
    try {
      await window.hnv.profiles.run(p.id)
      onRefreshIp() // lấy lại IP máy hiện tại (vd vừa bật/đổi VPN)
    } catch (e: any) {
      showToast(e?.message ?? 'Không mở được Chrome', 'error')
    } finally {
      setBusy(null)
    }
  }

  const stop = async (p: Profile): Promise<void> => {
    setBusy(p.id)
    try {
      await window.hnv.profiles.stop(p.id)
    } catch (e: any) {
      showToast(e?.message ?? 'Không đóng được Chrome', 'error')
    } finally {
      setBusy(null)
    }
  }

  const sync = async (p: Profile): Promise<void> => {
    setSyncing(p.id)
    try {
      const res = await window.hnv.profiles.syncTiktok(p.id)
      if (res.ok) onReload()
      else showToast(`${p.name}: ${res.reason ?? 'không lấy được username'}`, 'error')
    } catch (e: any) {
      showToast(e?.message ?? 'Lỗi đồng bộ', 'error')
    } finally {
      setSyncing(null)
    }
  }

  useEffect(() => {
    return window.hnv.onLoginProgress((id, msg) => {
      setLoginMsg((prev) => ({ ...prev, [id]: msg }))
    })
  }, [])

  useEffect(() => {
    return window.hnv.onEngineProgress((phase, pct) => {
      // 'done' là mốc ShardEngine phát khi runtime.install() xong → ẩn dòng này.
      setEngineProgress(phase === 'done' ? null : { phase, pct })
    })
  }, [])

  const login = async (p: Profile): Promise<void> => {
    setLoggingIn(p.id)
    setLoginMsg((prev) => ({ ...prev, [p.id]: 'Đang khởi động…' }))
    try {
      const res = await window.hnv.profiles.login(p.id)
      if (res.ok) {
        onReload()
      } else {
        showToast(`${p.name}: ${res.reason ?? 'Đăng nhập thất bại'}`, 'error')
      }
    } catch (e: any) {
      showToast(e?.message ?? 'Lỗi đăng nhập', 'error')
    } finally {
      setLoggingIn(null)
      setLoginMsg((prev) => { const n = { ...prev }; delete n[p.id]; return n })
    }
  }

  const toggleLogin = async (p: Profile): Promise<void> => {
    setTogglingLogin(p.id)
    try {
      await window.hnv.profiles.setLoggedIn(p.id, !p.loggedIn)
      onReload()
    } catch (e: any) {
      showToast(e?.message ?? 'Lỗi cập nhật trạng thái login', 'error')
    } finally {
      setTogglingLogin(null)
    }
  }

  const askRemoveAll = (): void => {
    if (profiles.some((p) => p.status === 'running')) {
      showToast('Có profile đang chạy — đóng hết trước khi xóa tất cả.', 'error')
      return
    }
    setConfirmingDelAll(true)
  }
  const removeAll = async (): Promise<void> => {
    setConfirmingDelAll(false)
    const n = await window.hnv.profiles.removeAll()
    onReload()
    showToast(`Đã xóa ${n} profile.`, 'success')
  }

  const syncAll = async (): Promise<void> => {
    setSyncingAll(true)
    let ok = 0
    let fail = 0
    for (const p of profiles) {
      if (p.status === 'running') {
        fail++
        continue
      }
      setSyncing(p.id)
      try {
        const res = await window.hnv.profiles.syncTiktok(p.id)
        res.ok ? ok++ : fail++
      } catch {
        fail++
      }
    }
    setSyncing(null)
    setSyncingAll(false)
    onReload()
    showToast(`Đồng bộ xong: ${ok} thành công, ${fail} bỏ qua/lỗi`, 'success')
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-[22px] pt-[18px] pb-3.5 text-[21px] font-bold">Profile</div>

      <div className="px-[22px] pb-3.5 flex items-center gap-2.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍  Tìm profile, nhóm..."
          className="flex-1 bg-[#101117] border border-border rounded-[10px] px-3.5 py-2.5 text-[14px] outline-none focus:border-[#3a3d6b]"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'default' | 'name' | 'lastUsed')}
          className="bg-[#101117] border border-border rounded-[10px] px-3 py-2.5 text-[14px] text-[#c7c8d4] outline-none focus:border-[#3a3d6b]"
          title="Sắp xếp"
        >
          <option value="default">Mặc định (mới tạo)</option>
          <option value="name">Tên A→Z</option>
          <option value="lastUsed">Truy cập gần nhất</option>
        </select>
        <button
          onClick={syncAll}
          disabled={syncingAll || profiles.length === 0}
          className="font-semibold text-[14px] rounded-[10px] px-4 py-2.5 bg-surface border border-border text-[#c7c8d4] hover:border-[#3a3d6b] disabled:opacity-50"
          title="Mở từng profile idle, lấy username TikTok và đặt làm tên"
        >
          {syncingAll ? '⏳ Đang đồng bộ…' : '🔄 Đồng bộ tất cả'}
        </button>
        <button
          onClick={askRemoveAll}
          disabled={profiles.length === 0}
          className="font-semibold text-[14px] rounded-[10px] px-4 py-2.5 bg-[#3a1f1f] text-[#f87171] border border-[#542c2c] hover:border-[#7a3c3c] disabled:opacity-40"
          title="Xóa toàn bộ profile và thư mục dữ liệu"
        >
          🗑 Xóa tất cả
        </button>
        <button
          onClick={() => setShowNew(true)}
          className="accent-grad text-[#0a0b10] font-bold text-[14px] rounded-[10px] px-4 py-2.5 shadow-[0_0_18px_rgba(99,102,241,.3)]"
        >
          + Profile mới
        </button>
      </div>

      {engineProgress && (
        <div className="px-[22px] pb-3">
          <div className="bg-card border border-borderSoft rounded-[10px] px-3.5 py-2.5 flex items-center gap-3">
            <span className="text-[13px] text-subtle shrink-0">
              ⏬ Đang tải engine trình duyệt — {engineProgress.phase}
            </span>
            <div className="flex-1 h-[6px] bg-[#101117] border border-border rounded-full overflow-hidden">
              <div className="h-full accent-grad" style={{ width: `${engineProgress.pct}%` }} />
            </div>
            <span className="text-[13px] text-accent2 font-semibold shrink-0 w-[42px] text-right">
              {engineProgress.pct}%
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto hv-scroll px-[22px] pb-3.5">
        {rows.length === 0 ? (
          <div className="text-muted text-center mt-20">
            Chưa có profile nào. Bấm <b className="text-accent2">+ Profile mới</b> để tạo.
          </div>
        ) : (
          <table className="w-full text-[14px]" style={{ borderCollapse: 'separate', borderSpacing: '0 0' }}>
            <thead className="text-muted">
              <tr className="text-left">
                <th className="px-3 py-2.5 font-semibold w-[44px] text-center">#</th>
                <th className="px-3 py-2.5 font-semibold">Tên</th>
                <th className="px-3 py-2.5 font-semibold">Nhóm</th>
                <th className="px-3 py-2.5 font-semibold">Quốc gia / IP</th>
                <th className="px-3 py-2.5 font-semibold">Trạng thái</th>
                <th className="px-3 py-2.5 font-semibold">Đã login</th>
                <th className="px-3 py-2.5 font-semibold">Cảnh báo</th>
                <th className="px-3 py-2.5 font-semibold text-center">Cài đặt</th>
                <th className="px-3 py-2.5 font-semibold">Lần cuối</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.id} className={i % 2 === 0 ? 'bg-[#0e0f15]' : ''}>
                  <td className="px-3 py-3 rounded-l-[10px] text-center text-muted">{i + 1}</td>
                  <td className="px-3 py-3 font-bold">{p.name}</td>
                  <td className="px-3 py-3">
                    {p.groupId ? (
                      <span>
                        <span style={{ color: p.groupColor ?? '#818cf8' }}>●</span> {p.groupName}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {p.proxy.useProxy ? (
                      <span>
                        <Flag code={p.proxyCountryCode} w={24} />
                        <b>{p.proxyCountry ?? 'Proxy'}</b>{' '}
                        <span className="text-subtle">{p.proxyIp ?? p.proxy.host}</span>
                      </span>
                    ) : (
                      <span>
                        <Flag code={machineIp?.countryCode} w={24} />
                        <b>{machineIp?.country ?? 'IP máy'}</b>{' '}
                        <span className="text-subtle">{machineIp?.ip ?? ''}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {p.status === 'running' ? (
                      <span className="text-ok">● Đang chạy</span>
                    ) : (
                      <span className="text-muted">○ Idle</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      onClick={() => toggleLogin(p)}
                      disabled={togglingLogin === p.id}
                      title={p.loggedIn ? 'Đánh dấu chưa login' : 'Đánh dấu đã login'}
                      className="disabled:opacity-40"
                    >
                      {togglingLogin === p.id ? '⏳' : p.loggedIn ? '✅' : '❌'}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <WarningFlags level={p.warningLevel} />
                  </td>
                  <td className="px-3 py-3 text-center whitespace-nowrap">
                    <button
                      onClick={() => login(p)}
                      disabled={loggingIn === p.id || p.status === 'running'}
                      className="w-8 h-8 rounded-lg bg-surface border border-border hover:border-[#3a3d6b] disabled:opacity-40 mr-1.5"
                      title={loggingIn === p.id ? (loginMsg[p.id] ?? 'Đang đăng nhập…') : 'Đăng nhập TikTok'}
                    >
                      {loggingIn === p.id ? '⏳' : '🔑'}
                    </button>
                    <button
                      onClick={() => sync(p)}
                      disabled={syncing === p.id || p.status === 'running'}
                      className="w-8 h-8 rounded-lg bg-surface border border-border hover:border-[#3a3d6b] disabled:opacity-40 mr-1.5"
                      title={p.status === 'running' ? 'Đóng profile trước khi đồng bộ' : 'Đồng bộ tên theo TikTok'}
                    >
                      {syncing === p.id ? '⏳' : '🔄'}
                    </button>
                    <button
                      onClick={() => setEditing(p)}
                      className="w-8 h-8 rounded-lg bg-surface border border-border hover:border-[#3a3d6b]"
                      title="Cài đặt"
                    >
                      ⚙️
                    </button>
                  </td>
                  <td className="px-3 py-3 text-muted">{timeAgo(p.lastUsedAt)}</td>
                  <td className="px-3 py-3 rounded-r-[10px] text-right">
                    {p.status === 'running' ? (
                      <button
                        disabled={busy === p.id}
                        onClick={() => stop(p)}
                        className="font-semibold rounded-lg px-4 py-1.5 bg-[#3a1f1f] text-[#f87171] border border-[#542c2c] disabled:opacity-50"
                      >
                        {busy === p.id ? '…' : '■ Dừng'}
                      </button>
                    ) : (
                      <button
                        disabled={busy === p.id}
                        onClick={() => run(p)}
                        className="font-semibold rounded-lg px-4 py-1.5 bg-[#1f3a2e] text-ok border border-[#2c5443] disabled:opacity-50"
                      >
                        {busy === p.id ? '…' : '▶ Run'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewProfileDialog
          groups={groups}
          machineIp={machineIp}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false)
            onReload()
          }}
        />
      )}
      {editing && (
        <ProfileSettingsDialog
          profile={editing}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onReload()
          }}
          onDeleted={() => {
            setEditing(null)
            onReload()
          }}
        />
      )}
      {confirmingDelAll && (
        <ConfirmDialog
          title="Xóa toàn bộ profile"
          message={`Xóa TOÀN BỘ ${profiles.length} profile và thư mục dữ liệu (session, cookie…) của chúng?\nHành động này KHÔNG thể khôi phục.`}
          confirmText={`🗑 Xóa ${profiles.length} profile`}
          onConfirm={removeAll}
          onCancel={() => setConfirmingDelAll(false)}
        />
      )}
    </div>
  )
}
