import { Fragment, useEffect, useMemo, useState } from 'react'
import { Avatar } from '../../components/Avatar'
import { Flag } from '../../components/Flag'
import { GroupMark } from '../../components/GroupMark'
import { Icon } from '../../components/Icon'
import { loadCollapsedGroups, saveCollapsedGroups, NO_GROUP } from '../../components/groupStyle'
import { timeAgo } from '../../lib/format'
import { runPool } from '../../lib/pool'
import { GroupDialog } from './GroupDialog'
import { NewProfileDialog } from './NewProfileDialog'
import { ProfilePanel } from './ProfilePanel'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Select } from '../../components/Select'
import { showToast } from '../../components/uiDialogs'
import type { Group, MachineIp, Profile, Proxy } from '@shared/types'

/** Cờ cảnh báo 1..5, tăng dần trái→phải. Bấm cờ thứ i để đặt mức = i; bấm lại đúng
 *  cờ đang là mức hiện tại thì lùi về i-1 (cách duy nhất để về 0/bỏ cảnh báo). */
function WarningFlags({
  level,
  onChange,
  disabled,
  disabledTitle,
}: {
  level: number
  onChange: (level: number) => void
  disabled?: boolean
  disabledTitle?: string
}): JSX.Element {
  return (
    <span className={'whitespace-nowrap inline-flex ' + (disabled ? 'opacity-40 grayscale' : '')}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          onClick={() => onChange(level === i ? i - 1 : i)}
          className={
            'leading-none px-0.5 transition-transform ' +
            (disabled ? 'cursor-not-allowed' : 'hover:scale-110') +
            ' ' +
            (i <= level ? '' : 'opacity-20 grayscale')
          }
          title={disabled ? disabledTitle : `Đặt cảnh báo mức ${i}/5${level === i ? ' (bấm lại để bỏ)' : ''}`}
        >
          🚩
        </button>
      ))}
    </span>
  )
}

// Tạm ẩn cột "Cảnh báo" theo yêu cầu. Đổi lại thành true là hiện nguyên trạng —
// cả <th>, ô trong hàng lẫn COL_COUNT đều bám vào đúng cờ này nên không cần sửa
// chỗ nào khác.
const SHOW_WARNING_COL = false

// Actual column count in the <thead> below (Avatar, Name, Country/IP, Status,
// Logged in, [Warning], Last used, Actions). Shared by both the <thead> and the
// colSpan of the group-header and settings-panel rows — declared once so the
// three can't drift apart on a later edit.
const COL_COUNT = SHOW_WARNING_COL ? 8 : 7

/**
 * Số hồ sơ đồng bộ cùng lúc khi bấm "Đồng bộ".
 *
 * Trước đây nút này chạy tuần tự từng hồ sơ. Mỗi lượt syncTiktok mở HẲN một
 * Chromium riêng kèm proxy và vân tay của nó, và tự nó đã có sẵn ngân sách chờ
 * dài: dò username tới 20s, chờ avatar tới 15s, dò trang monetization tới 24s.
 * Nhân với số hồ sơ thì cả lượt tính bằng chục phút, mà phần lớn thời gian là
 * ngồi chờ mạng chứ không phải làm gì.
 *
 * Không đẩy cao hơn 3: mỗi Chromium là một tiến trình thật, và máy này đo được
 * 15,9 GB RAM tổng nhưng chỉ còn 4,9 GB trống lúc app đang mở. AnalyticsService
 * để 2 cho pha đọc số dư — cùng hình dạng "một Chromium mỗi hồ sơ" — nên 3 đã là
 * nhích lên rồi. Thắt cổ chai ở đây là RAM, không phải CPU (máy có 16 nhân).
 */
const SYNC_POOL = 3

type SortBy = 'default' | 'name' | 'lastUsed' | 'group'

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'default', label: 'Mặc định (mới tạo)' },
  { value: 'name', label: 'Tên A→Z' },
  { value: 'lastUsed', label: 'Truy cập gần nhất' }
]

// Bốn lệnh bên phải thanh công cụ dùng chung khuôn này: nền gradient, chữ tối,
// cao 40px — bằng đúng Select bên trái nên cả hàng thẳng mép. Viết một lần ở
// đây thay vì dán bốn lần: dán là kiểu gì cũng có ngày sửa một nút quên ba nút.
// Riêng màu nền, màu chữ và quầng sáng thì mỗi nút một bộ, khai báo ngay dưới.
// w cố định + justify-center: bốn nút rộng bằng nhau. 150px rộng hơn mọi nhãn
// hiện có — không nhãn nào đổi khi bấm nữa, kể cả nút Đồng bộ — nên chỗ thừa là
// cố ý: giữ hàng nút không so le và không nhúc nhích.
const TOOLBAR_BTN =
  'h-10 w-[150px] inline-flex items-center justify-center gap-1.5 font-bold text-[14px] rounded-[10px] px-3'

// Chữ tối trên nền sáng, mỗi màu một sắc tối cùng tông để không bị xám xịt.
const BTN_GROUP = `${TOOLBAR_BTN} warn-grad text-[#2a1608] shadow-[0_0_18px_rgba(251,191,36,.26)]`
const BTN_SYNC = `${TOOLBAR_BTN} ok-grad text-[#062018] shadow-[0_0_18px_rgba(52,211,153,.26)]`
const BTN_DELETE = `${TOOLBAR_BTN} danger-grad text-[#2a0d12] shadow-[0_0_18px_rgba(244,63,94,.26)]`
const BTN_NEW = `${TOOLBAR_BTN} accent-grad text-[#0a0b10] shadow-[0_0_18px_rgba(99,102,241,.3)]`

export function ProfileTab({
  profiles,
  groups,
  machineIp,
  onReload,
  onRefreshIp,
}: {
  profiles: Profile[]
  groups: Group[]
  machineIp: MachineIp | null
  onReload: () => void
  onRefreshIp: () => void
}): JSX.Element {
  const [q, setQ] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('default')
  const [sortOpen, setSortOpen] = useState(false)
  const [showNew, setShowNew] = useState(false)
  // id of the profile whose inline settings panel is expanded right below its
  // row (replaces the old modal). null = no row open.
  const [openId, setOpenId] = useState<string | null>(null)
  // Ids whose settings panel row stays fully mounted in the DOM. Always a
  // superset of {openId} while an open/close transition may still be playing;
  // shrinks back to exactly {openId} once the 0.32s grid-rows transition
  // (index.css .hv-panel-collapse) would have finished. React can't animate an
  // unmount, so the row must stay in the DOM until the CSS transition actually
  // finishes playing, not vanish the instant openId changes — same technique as
  // SearchPanel's `detailMounted` (grep cs-drow in index.css / SearchPanel.tsx).
  const [mountedIds, setMountedIds] = useState<Set<string>>(new Set())
  // KNOWN GAP: the panel animates shut but snaps open.
  //
  // The collapse runs the 0.32s grid-rows transition normally (measured
  // 840 -> 815 -> 737 -> ... -> 0); the expand jumps to full height in one
  // frame and fires no transitionrun event at all. Ruled out by measurement on
  // the live panel, not by reasoning: mounting the content in the same commit
  // as the class (a painted collapsed frame first changes nothing), applying
  // the class directly to the element instead of through a re-render, forcing
  // layout in between, the element being inside a <td>, the content being
  // injected at open time, whether it is the first open or a later one, and
  // driving it with the Web Animations API. Isolated copies of the same markup
  // and CSS animate both ways, so something about this element in this tree
  // stops Chromium from setting the transition up.
  //
  // Left as-is deliberately rather than carrying speculative machinery that was
  // measured to make no difference. A height-in-pixels accordion (measure, then
  // animate an explicit height) does not rely on the browser noticing a style
  // diff and would sidestep this entirely — that is the next thing to try.
  const togglePanel = (id: string): void => {
    const next = openId === id ? null : id
    if (next) setMountedIds((s) => (s.has(next) ? s : new Set(s).add(next)))
    setOpenId(next)
  }
  // Once the accordion settles (no further openId change for 0.32s), drop any
  // row that's mounted but no longer open — its close transition has finished.
  useEffect(() => {
    const t = setTimeout(() => setMountedIds(openId ? new Set([openId]) : new Set()), 320)
    return () => clearTimeout(t)
  }, [openId])
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  // Tập id đang đồng bộ — TẬP chứ không phải một id, vì "Đồng bộ" giờ chạy nhiều
  // hồ sơ cùng lúc (xem SYNC_POOL) nên nhiều hàng phải quay được đồng thời.
  const [syncing, setSyncing] = useState<Set<string>>(new Set())
  const [togglingLogin, setTogglingLogin] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState<string | null>(null)
  const [loginMsg, setLoginMsg] = useState<Record<string, string>>({})
  const [confirmingDelAll, setConfirmingDelAll] = useState(false)
  const [syncingAll, setSyncingAll] = useState(false)
  // Tiến trình tải engine ShardX. Lần chạy đầu (và mỗi lần engine tự cập nhật
  // theo manifest) việc tải vài trăm MB xảy ra BÊN TRONG lệnh mở profile, nên
  // không có dòng này thì nút "Mở" đứng im nhiều phút và app trông như bị treo.
  const [engineProgress, setEngineProgress] = useState<{
    phase: string
    pct: number
  } | null>(null)

  // ── Cây thư mục: thu/mở, chọn nhiều, kéo thả ─────────────────────────────
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsedGroups)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lastClickedId, setLastClickedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [groupDialog, setGroupDialog] = useState<{
    group: Group | null
  } | null>(null)
  const [movingTo, setMovingTo] = useState(false)

  const toggleGroup = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveCollapsedGroups(next)
      return next
    })
  }

  // ProfilePanel (inline) needs the proxy list to render its proxy-picker
  // dropdown — ProfileTab loads it itself since App.tsx has no shared proxies
  // state yet.
  useEffect(() => {
    window.hnv.proxies
      .list()
      .then(setProxies)
      .catch((e: any) => {
        // Without a .catch here the rejection is silent — the panel's proxy
        // dropdown just renders empty, and the user reads that as "no proxies
        // configured" instead of a load error.
        showToast(e?.message ?? 'Không tải được danh sách proxy', 'error')
      })
  }, [])

  // Bảng LUÔN gom theo nhóm. Kiểu sắp xếp áp dụng TRONG từng nhóm, không phải cho
  // cả bảng — vì thế lựa chọn "Theo nhóm" cũ đã bỏ đi, giờ nó là mặc định.
  const sections = useMemo(() => {
    const t = q.trim().toLowerCase()
    const filtered = t
      ? profiles.filter((p) => p.name.toLowerCase().includes(t) || (p.groupName ?? '').toLowerCase().includes(t))
      : profiles

    const sortIn = (arr: Profile[]): Profile[] => {
      if (sortBy === 'default') return arr
      const out = [...arr]
      if (sortBy === 'name') out.sort((a, b) => a.name.localeCompare(b.name, 'vi'))
      // mới truy cập nhất lên đầu; chưa từng dùng (null) xuống cuối
      else if (sortBy === 'lastUsed') out.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
      return out
    }

    const byGroup = new Map<string, Profile[]>()
    for (const p of filtered) {
      const key = p.groupId ?? NO_GROUP
      if (!byGroup.has(key)) byGroup.set(key, [])
      byGroup.get(key)!.push(p)
    }

    // Mọi nhóm đều hiện, kể cả nhóm rỗng — nhóm vừa tạo mà không thấy đâu thì
    // không kéo thả profile vào được. Ngoại lệ: đang lọc bằng ô tìm kiếm thì nhóm
    // không còn kết quả nào bị ẩn, để kết quả tìm kiếm không lọt thỏm giữa các
    // tiêu đề rỗng.
    const out: { group: Group | null; items: Profile[] }[] = []
    for (const g of [...groups].sort((a, b) => a.name.localeCompare(b.name, 'vi'))) {
      const items = byGroup.get(g.id) ?? []
      if (t && items.length === 0) continue
      out.push({ group: g, items: sortIn(items) })
    }
    const loose = byGroup.get(NO_GROUP) ?? []
    if (loose.length > 0 || !t) out.push({ group: null, items: sortIn(loose) }) // "Không nhóm" luôn cuối
    return out
  }, [profiles, groups, q, sortBy])

  /** Thứ tự phẳng đang hiển thị — Shift+click chọn dải dựa vào đúng thứ tự này. */
  const visibleOrder = useMemo(
    () => sections.flatMap((s) => (collapsed.has(s.group?.id ?? NO_GROUP) ? [] : s.items.map((p) => p.id))),
    [sections, collapsed],
  )

  /** Click chọn hàng: thường = chọn một, Ctrl = thêm/bớt, Shift = chọn cả dải. */
  const clickRow = (id: string, e: React.MouseEvent): void => {
    // Hàng bọc cả cụm nút Mở/Dừng/🔑/🔄/⚙ và các cờ cảnh báo. Bấm chúng thì việc
    // chọn hàng không được xen vào — nếu không, mỗi lần mở một profile là tập
    // đang chọn bị đặt lại thành đúng hàng đó.
    if ((e.target as HTMLElement).closest('button')) return
    if (e.shiftKey && lastClickedId) {
      const a = visibleOrder.indexOf(lastClickedId)
      const b = visibleOrder.indexOf(id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelectedIds(new Set(visibleOrder.slice(lo, hi + 1)))
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    } else {
      setSelectedIds((prev) => (prev.size === 1 && prev.has(id) ? new Set() : new Set([id])))
    }
    setLastClickedId(id)
  }

  /** Chuyển tập id sang một nhóm (null = bỏ nhóm). Dùng cho cả kéo thả lẫn nút. */
  const moveTo = async (ids: string[], groupId: string | null): Promise<void> => {
    if (ids.length === 0) return
    setMovingTo(true)
    try {
      await window.hnv.groups.assign(ids, groupId)
      setSelectedIds(new Set())
      onReload()
    } catch (e: any) {
      showToast(e?.message ?? 'Không chuyển được nhóm', 'error')
    } finally {
      setMovingTo(false)
    }
  }

  const onDropIntoGroup = (groupId: string | null, e: React.DragEvent): void => {
    e.preventDefault()
    setDropTarget(null)
    const dragged = e.dataTransfer.getData('text/plain')
    if (!dragged) return
    // Kéo một hàng đang nằm trong tập đã chọn = kéo cả tập; kéo hàng ngoài tập thì
    // chỉ kéo đúng nó (và không phá tập đang chọn).
    const ids = selectedIds.has(dragged) ? [...selectedIds] : [dragged]
    void moveTo(ids, groupId)
  }

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

  const setWarning = async (p: Profile, level: number): Promise<void> => {
    await window.hnv.profiles.update({ ...p, warningLevel: level })
    onReload()
  }

  const markSync = (id: string, on: boolean): void =>
    setSyncing((prev) => {
      const n = new Set(prev)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  const sync = async (p: Profile): Promise<void> => {
    markSync(p.id, true)
    try {
      const res = await window.hnv.profiles.syncTiktok(p.id)
      if (res.ok) onReload()
      else showToast(`${p.name}: ${res.reason ?? 'không lấy được username'}`, 'error')
    } catch (e: any) {
      showToast(e?.message ?? 'Lỗi đồng bộ', 'error')
    } finally {
      markSync(p.id, false)
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
      setLoginMsg((prev) => {
        const n = { ...prev }
        delete n[p.id]
        return n
      })
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
      showToast('Có hồ sơ đang chạy — đóng hết trước khi xóa tất cả.', 'error')
      return
    }
    setConfirmingDelAll(true)
  }
  const removeAll = async (): Promise<void> => {
    setConfirmingDelAll(false)
    const n = await window.hnv.profiles.removeAll()
    onReload()
    showToast(`Đã xóa ${n} hồ sơ.`, 'success')
  }

  const syncAll = async (): Promise<void> => {
    setSyncingAll(true)
    const queue = profiles.filter((p) => p.status !== 'running')
    let ok = 0
    let fail = profiles.length - queue.length // đang chạy = bỏ qua, tính vào fail như cũ
    await runPool(queue, SYNC_POOL, async (p) => {
      markSync(p.id, true)
      try {
        const res = await window.hnv.profiles.syncTiktok(p.id)
        res.ok ? ok++ : fail++
      } catch {
        fail++
      } finally {
        markSync(p.id, false)
      }
    })
    setSyncing(new Set())
    setSyncingAll(false)
    onReload()
    showToast(`Đồng bộ xong: ${ok} thành công, ${fail} bỏ qua/lỗi`, 'success')
  }

  return (
    // relative: thanh hành động của tập đang chọn neo vào chính vùng tab này
    <div className="flex-1 flex flex-col min-w-0 relative">
      {/* pr-[32px] = the 22px the scroll area below uses, plus the 10px of
          scrollbar gutter it permanently reserves (.hv-tabscroll). These rows
          sit OUTSIDE that container, so with a plain px-[22px] their right edge
          lands at 1536 while the table's lands at 1504 — measured — and the
          toolbar reads as misaligned with the content under it. */}
      <div className="pl-[22px] pr-[32px] pt-[18px] pb-3.5 text-[21px] font-bold text-grad flex items-center gap-2">
        <Icon name="profile" filled size={24} className="icon-grad" />
        Hồ sơ
      </div>

      <div className="pl-[22px] pr-[32px] pb-3.5 flex items-center gap-2.5">
        {/* Kính lúp phải là phần tử riêng chứ không nhét vào placeholder: chữ
            placeholder biến mất ngay khi gõ chữ đầu tiên, mà icon thì phải ở lại. */}
        <div className="relative w-[280px] shrink-0">
          <Icon
            name="search"
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm hồ sơ, nhóm..."
            className="w-full h-10 bg-[#101117] border border-border rounded-[10px] pl-10 pr-3.5 text-[14px] outline-none focus:border-[#3a3d6b]"
          />
        </div>
        {/* Bộ lọc thu về một nút icon: ô Select cũ chiếm 190px thanh công cụ chỉ
            để hiện lại thứ đang chọn — thứ vốn đã thấy được qua thứ tự các hàng.
            Chấm nhỏ trên nút báo "đang lọc khác mặc định" nên không mất thông tin. */}
        <div className="relative shrink-0">
          <button
            onClick={() => setSortOpen((v) => !v)}
            title={`Sắp xếp: ${SORT_OPTIONS.find((o) => o.value === sortBy)?.label}`}
            aria-label="Sắp xếp"
            className={
              'w-10 h-10 inline-flex items-center justify-center rounded-[10px] border transition ' +
              (sortOpen || sortBy !== 'default'
                ? 'border-[#3a3d6b] bg-[rgba(99,102,241,.14)] text-white'
                : 'border-border bg-surface text-[#c7c8d4] hover:border-[#3a3d6b]')
            }
          >
            <Icon name="filter" filled size={19} />
            {sortBy !== 'default' && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent2" />
            )}
          </button>
          {sortOpen && (
            <>
              {/* Lớp phủ trong suốt: bấm ra ngoài là đóng, không cần nghe sự kiện
                  trên document rồi phải nhớ gỡ đi. */}
              <div className="fixed inset-0 z-[70]" onMouseDown={() => setSortOpen(false)} />
              <div className="absolute z-[71] top-[46px] left-0 w-[212px] p-1.5 rounded-[10px] bg-[#14151c] border border-[#2e3040] shadow-[0_18px_44px_-12px_rgba(0,0,0,.8)]">
                <div className="px-2.5 py-1 text-[11px] uppercase tracking-wide text-subtle">Sắp xếp theo</div>
                {SORT_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => {
                      setSortBy(o.value)
                      setSortOpen(false)
                    }}
                    className={
                      'w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-[7px] text-[13.5px] ' +
                      (o.value === sortBy ? 'text-white bg-[rgba(99,102,241,.16)]' : 'text-[#c7c8d4] hover:bg-surface')
                    }
                  >
                    <Icon
                      name="check"
                      size={15}
                      className={'shrink-0 ' + (o.value === sortBy ? 'text-accent2' : 'opacity-0')}
                    />
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setGroupDialog({ group: null })}
          className={`ml-auto ${BTN_GROUP}`}
          title="Tạo nhóm mới và chọn hồ sơ cho nhóm"
        >
          <Icon name="folderAdd" filled size={19} className="shrink-0" />
          Nhóm mới
        </button>
        <button
          onClick={syncAll}
          disabled={syncingAll || profiles.length === 0}
          className={`${BTN_SYNC} disabled:opacity-50`}
          title="Mở từng hồ sơ idle, lấy username TikTok và đặt làm tên"
        >
          {/* Nhãn KHÔNG đổi khi đang chạy: icon quay đã đủ báo trạng thái, mà chữ
              đứng yên thì nút không nhúc nhích. Quay ngược chiều (.hv-spin-rev)
              cho khớp hướng hai mũi tên của chính icon sync. */}
          <Icon name="sync" filled size={19} className={`shrink-0 ${syncingAll ? 'hv-spin-rev' : ''}`} />
          Đồng bộ
        </button>
        <button
          onClick={askRemoveAll}
          disabled={profiles.length === 0}
          className={`${BTN_DELETE} disabled:opacity-40`}
          title="Xóa toàn bộ hồ sơ và thư mục dữ liệu"
        >
          <Icon name="trash" filled size={19} className="shrink-0" />
          Xóa tất cả
        </button>
        <button onClick={() => setShowNew(true)} className={BTN_NEW}>
          <Icon name="userAdd" filled size={19} className="shrink-0" />
          Hồ sơ mới
        </button>
      </div>

      {engineProgress && (
        <div className="pl-[22px] pr-[32px] pb-3">
          <div className="bg-card border border-borderSoft rounded-[10px] px-3.5 py-2.5 flex items-center gap-3">
            <span className="text-[13px] text-subtle shrink-0 inline-flex items-center gap-1.5">
              <Icon name="download" filled size={16} />
              Đang tải engine trình duyệt — {engineProgress.phase}
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

      <div className="flex-1 overflow-auto hv-scroll hv-tabscroll px-[22px] pb-3.5">
        {profiles.length === 0 ? (
          <div className="text-muted text-center mt-20">
            Chưa có hồ sơ nào. Bấm <b className="text-accent2">+ Hồ sơ mới</b> để tạo.
          </div>
        ) : sections.length === 0 ? (
          <div className="text-muted text-center mt-20">Không có hồ sơ nào khớp &quot;{q}&quot;.</div>
        ) : (
          /* Khung bao quanh cả bảng — cùng khuôn với bảng ở tab Analytics. Cái
             làm nên khung không phải cái viền (borderSoft trên nền tab chỉ đạt
             1.3:1, gần như không thấy) mà là nền card sáng hơn nền tab một bậc. */
          <div className="bg-card border border-borderSoft rounded-[14px] overflow-hidden">
            <table className="w-full text-[14px]" style={{ borderCollapse: 'separate', borderSpacing: '0 0' }}>
            <thead className="hv-th-grad">
              {/* COL_COUNT (={COL_COUNT}) must match the number of <th> here — the
                  expanded panel row uses colSpan={COL_COUNT}, so these two can't be
                  allowed to drift apart. */}
              <tr className="text-left">
                {/* 84px, không đệm phải — vẫn sát cột Tên hơn mức cũ (96px), nhưng
                    đủ chỗ để icon nhóm và avatar không dính nhau: icon 16px chiếm
                    8..24px, avatar 36px căn giữa vùng nội dung 72px nên bắt đầu ở
                    30px → hở 6px. Tâm avatar và tâm chữ "Ảnh" cùng ở 48px. */}
                <th className="pl-3 pr-0 py-2.5 font-semibold w-[84px] text-center">Ảnh</th>
                <th className="px-3 py-2.5 font-semibold">Tên</th>
                <th className="px-3 py-2.5 font-semibold text-center">Quốc gia / IP</th>
                <th className="px-3 py-2.5 font-semibold text-center">Trạng thái</th>
                <th className="px-3 py-2.5 font-semibold text-center">Đã login</th>
                {SHOW_WARNING_COL && <th className="px-3 py-2.5 font-semibold text-center">Cảnh báo</th>}
                <th className="px-3 py-2.5 font-semibold text-center">Lần cuối</th>
                {/* text-center như sáu cột trên. Bề rộng cột này do cụm nút quyết định
                    (nó rộng hơn chữ "Thao tác" nhiều), nên tâm cột chính là tâm cụm nút
                    — căn giữa thì tiêu đề nằm đúng trên chúng. */}
                <th className="px-3 py-2.5 font-semibold text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((sec) => {
                const key = sec.group?.id ?? NO_GROUP
                const isCollapsed = collapsed.has(key)
                const isDropTarget = dropTarget === key
                return (
                  <Fragment key={key}>
                    {/* ── Hàng tiêu đề nhóm (thư mục) ──────────────────────── */}
                    <tr>
                      <td colSpan={COL_COUNT} className="p-0">
                        {/* width:0 + min-width:100% giữ ô colSpan này NGOÀI phép tính
                            bề rộng cột của trình duyệt. Không có nó, nội dung tiêu đề
                            nhóm sẽ kéo các cột lệch đi mỗi khi tên nhóm dài ra — đúng
                            lỗi đã đo và sửa cho hàng panel cài đặt (xem
                            .hv-panel-collapse trong index.css). */}
                        <div style={{ width: 0, minWidth: '100%' }} className="pt-2.5 pb-1">
                          <div
                            onClick={() => toggleGroup(key)}
                            onDragOver={(e) => {
                              e.preventDefault()
                              setDropTarget(key)
                            }}
                            onDragLeave={() => setDropTarget((t) => (t === key ? null : t))}
                            onDrop={(e) => onDropIntoGroup(sec.group?.id ?? null, e)}
                            className={
                              'flex items-center gap-2 px-3 py-2 rounded-[10px] cursor-pointer select-none border ' +
                              (isDropTarget
                                ? 'border-dashed border-accent bg-[#12131b]'
                                : 'border-borderSoft bg-[#12131b] hover:border-[#2b2d45]')
                            }
                          >
                            <span className="text-subtle w-3 text-center">{isCollapsed ? '▸' : '▾'}</span>
                            <GroupMark icon={sec.group?.icon} color={sec.group?.color} />
                            <span className={'font-semibold ' + (sec.group ? '' : 'text-subtle')}>
                              {sec.group?.name ?? 'Không nhóm'}
                            </span>
                            <span className="rounded-full border border-border bg-[#1b1c25] px-2 py-[1px] text-[11.5px] text-subtle">
                              {sec.items.length}
                            </span>
                            {isDropTarget && (
                              <span className="text-[12px] text-accent2">thả vào đây để chuyển nhóm</span>
                            )}
                            {sec.group && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation() // đừng thu/mở nhóm khi mở cài đặt
                                  setGroupDialog({ group: sec.group })
                                }}
                                className="ml-auto w-7 h-7 rounded-lg border border-border bg-surface text-muted hover:text-white hover:border-[#3a3d6b]"
                                title="Cài đặt nhóm"
                              >
                                ⋯
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>

                    {!isCollapsed &&
                      sec.items.map((p, i) => {
                        const isOpen = openId === p.id
                        const isSelected = selectedIds.has(p.id)
                        return (
                          // key must sit on the Fragment (the outermost element .map()
                          // returns) — the shorthand <>...</> can't take a key.
                          <Fragment key={p.id}>
                            <tr
                              draggable
                              onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)}
                              onClick={(e) => clickRow(p.id, e)}
                              className={
                                'cursor-pointer ' +
                                (isSelected
                                  ? 'bg-[#161a2e]'
                                  : isOpen
                                    ? 'bg-[#12131b]'
                                    : i % 2 === 0
                                      ? 'bg-[#0e0f15]'
                                      : '')
                              }
                            >
                              {/* Icon nhóm đứng riêng bên trái avatar, thay cho cột "Nhóm"
                          cũ: hàng đã nằm sẵn dưới tiêu đề nhóm của nó, nên một cột
                          chỉ để lặp lại cái tên đó là thừa. Ô icon giữ bề rộng cố
                          định kể cả khi rỗng — nếu không, avatar của hồ sơ không
                          thuộc nhóm nào sẽ lệch sang trái so với các hàng khác. */}
                              <td className={`relative pl-3 pr-0 py-3 ${isOpen ? 'rounded-tl-[10px]' : 'rounded-l-[10px]'}`}>
                                {/* Icon nhóm ĐỨNG NGOÀI luồng (absolute). Trước đây nó nằm
                                    cùng flex với avatar, nên cụm hai phần tử mới là thứ
                                    được căn giữa — avatar bị đẩy lệch phải và không còn
                                    thẳng với chữ "Ảnh" ở tiêu đề cột. Giờ avatar căn giữa
                                    ô một mình, icon nổi lên bên trái. */}
                                <span
                                  className="absolute left-2 top-1/2 -translate-y-1/2 w-4 flex items-center justify-center"
                                  title={p.groupName ?? ''}
                                >
                                  {p.groupId && <GroupMark icon={p.groupIcon} color={p.groupColor} size={15} />}
                                </span>
                                <div className="flex items-center justify-center">
                                  <Avatar src={p.avatar} name={p.name} />
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <div className="font-bold">{p.name}</div>
                                <div className="text-[11px] text-muted font-mono mt-0.5">{p.id.slice(0, 8)}</div>
                              </td>
                              <td className="px-3 py-3 text-center">
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
                              <td className="px-3 py-3 text-center">
                                {/* Bề rộng CỐ ĐỊNH theo nhãn dài nhất: đo thật thì "Nghỉ" ra
                            64.3px còn "Đang chạy" 96.4px — để nội dung quyết định thì
                            viền phù hiệu phình/co 32px mỗi lần mở hay đóng hồ sơ. */}
                                {p.status === 'running' ? (
                                  <span className="w-[100px] inline-flex items-center justify-center gap-1.5 rounded-full border border-[#2c5443] bg-[rgba(52,211,153,.12)] py-[3px] text-[12.5px] font-semibold text-ok">
                                    <span className="w-[7px] h-[7px] rounded-full bg-current" />
                                    Đang chạy
                                  </span>
                                ) : (
                                  <span className="w-[100px] inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-[#101117] py-[3px] text-[12.5px] font-semibold text-subtle">
                                    <span className="w-[7px] h-[7px] rounded-full bg-current" />
                                    Nghỉ
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-center">
                                <button
                                  onClick={() => toggleLogin(p)}
                                  disabled={togglingLogin === p.id || isOpen}
                                  title={
                                    isOpen
                                      ? 'Đang sửa trong panel cài đặt — đóng panel để đổi ở đây'
                                      : p.loggedIn
                                        ? 'Đánh dấu chưa login'
                                        : 'Đánh dấu đã login'
                                  }
                                  className="disabled:opacity-40 inline-flex items-center justify-center"
                                >
                                  {togglingLogin === p.id ? (
                                    <Icon name="hourglass" size={19} className="text-muted" />
                                  ) : p.loggedIn ? (
                                    <Icon name="checkCircle" filled size={19} className="text-ok" />
                                  ) : (
                                    <Icon name="cancel" filled size={19} className="text-danger" />
                                  )}
                                </button>
                              </td>
                              {SHOW_WARNING_COL && (
                                <td className="px-3 py-3 text-center">
                                  <WarningFlags
                                    level={p.warningLevel}
                                    onChange={(level) => setWarning(p, level)}
                                    disabled={isOpen}
                                    disabledTitle="Đang sửa trong panel cài đặt — đóng panel để đổi ở đây"
                                  />
                                </td>
                              )}
                              <td className="px-3 py-3 text-center text-muted">{timeAgo(p.lastUsedAt)}</td>
                              <td
                                className={`px-3 py-3 text-right whitespace-nowrap ${isOpen ? 'rounded-tr-[10px]' : 'rounded-r-[10px]'}`}
                              >
                                <div className="flex items-center justify-end gap-1.5">
                                  {/* Bề rộng CỐ ĐỊNH, không để nội dung quyết định: đo thật
                              với font của app thì "▶ Mở" ra 71px, "■ Dừng" 84.9px và
                              "…" (lúc đang bận) chỉ 45px — nút co giãn tới 40px mỗi
                              lần đổi trạng thái, kéo theo cả cụm nút bên cạnh nhảy. */}
                                  {p.status === 'running' ? (
                                    <button
                                      disabled={busy === p.id}
                                      onClick={() => stop(p)}
                                      className="w-[88px] inline-flex items-center justify-center font-semibold rounded-lg py-1.5 bg-[#3a1f1f] text-[#f87171] border border-[#542c2c] disabled:opacity-50"
                                    >
                                      {busy === p.id ? (
                                        '…'
                                      ) : (
                                        <>
                                          <Icon name="stop" filled size={17} className="mr-1" /> Dừng
                                        </>
                                      )}
                                    </button>
                                  ) : (
                                    <button
                                      disabled={busy === p.id}
                                      onClick={() => run(p)}
                                      className="w-[88px] inline-flex items-center justify-center font-semibold rounded-lg py-1.5 bg-[#1f3a2e] text-ok border border-[#2c5443] disabled:opacity-50"
                                    >
                                      {busy === p.id ? (
                                        '…'
                                      ) : (
                                        <>
                                          <Icon name="play" filled size={17} className="mr-1" /> Mở
                                        </>
                                      )}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => login(p)}
                                    disabled={loggingIn === p.id || p.status === 'running' || isOpen}
                                    className="w-8 h-8 rounded-lg bg-surface border border-border hover:border-[#3a3d6b] disabled:opacity-40 inline-flex items-center justify-center"
                                    title={
                                      loggingIn === p.id
                                        ? (loginMsg[p.id] ?? 'Đang đăng nhập…')
                                        : isOpen
                                          ? 'Đang sửa trong panel cài đặt — đóng panel để đổi ở đây'
                                          : 'Đăng nhập TikTok'
                                    }
                                  >
                                    <Icon name={loggingIn === p.id ? 'hourglass' : 'key'} filled size={17} />
                                  </button>
                                  <button
                                    onClick={() => sync(p)}
                                    disabled={syncing.has(p.id) || p.status === 'running' || isOpen}
                                    className="w-8 h-8 rounded-lg bg-surface border border-border hover:border-[#3a3d6b] disabled:opacity-40 inline-flex items-center justify-center"
                                    title={
                                      isOpen
                                        ? 'Đang sửa trong panel cài đặt — đóng panel để đổi ở đây'
                                        : p.status === 'running'
                                          ? 'Đóng hồ sơ trước khi đồng bộ'
                                          : 'Đồng bộ tên theo TikTok'
                                    }
                                  >
                                    <Icon
                                      name={syncing.has(p.id) ? 'hourglass' : 'refresh'}
                                      filled
                                      size={17}
                                      className={syncing.has(p.id) ? '' : 'text-[#c7c8d4]'}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => togglePanel(p.id)}
                                    className={`w-8 h-8 rounded-lg border bg-surface flex items-center justify-center hover:border-[#3a3d6b] ${
                                      isOpen ? 'border-[#3a3d6b] text-white' : 'border-border'
                                    }`}
                                    title="Cài đặt"
                                  >
                                    <Icon name="setting" filled size={17} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {/* Always rendered, even fully closed — the grid element must already
                        exist in the DOM before "open" is ever added to it. Mounting the
                        row already-open would give the browser no earlier frame to
                        transition from, so the very first expand would snap open instead
                        of animating (same reasoning as SearchPanel's cs-drow). See
                        .hv-panel-collapse / .hv-panel-collapse-inner in index.css for the
                        0fr/1fr grid-rows expand + the overflow flip that keeps
                        GroupSelect/ProxySelect dropdowns from being clipped once open. */}
                            <tr>
                              <td colSpan={COL_COUNT} className="p-0">
                                <div className={`hv-panel-collapse${isOpen ? ' open' : ''}`}>
                                  <div className="hv-panel-collapse-inner bg-[#0d0e14] rounded-b-[10px]">
                                    {mountedIds.has(p.id) && (
                                      // key={p.id} is the primary defense: it forces React to fully
                                      // remount ProfilePanel when the row's profile changes, so stale
                                      // state from the previous profile can never leak through. The
                                      // useEffect([profile.id]) inside ProfilePanel is only a safety
                                      // net for if this key is ever removed — with the key in place,
                                      // that effect never actually runs across an id change (the
                                      // remount resets all state before the effect would fire). Keep
                                      // both, but they are not two independent, parallel layers.
                                      <ProfilePanel
                                        key={p.id}
                                        profile={p}
                                        groups={groups}
                                        proxies={proxies}
                                        onSaved={() => {
                                          setOpenId(null)
                                          onReload()
                                        }}
                                        onClose={() => setOpenId(null)}
                                      />
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          </Fragment>
                        )
                      })}
                  </Fragment>
                )
              })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Thanh hành động cho tập đang chọn. Nổi ở đáy vùng bảng thay vì chèn thêm
          một hàng vào <table> — chèn vào bảng sẽ lại đụng đúng chuyện tính bề rộng
          cột mà cả hàng tiêu đề nhóm lẫn hàng panel cài đặt đều phải né. */}
      {selectedIds.size > 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-6 z-40 flex items-center gap-2.5 bg-[#12131b] border border-[#2b2d45] rounded-[12px] px-3.5 py-2.5 shadow-2xl">
          <span className="text-[13.5px] text-subtle">
            Đã chọn <b className="text-white">{selectedIds.size}</b>
          </span>
          <Select
            value=""
            onChange={(v) => void moveTo([...selectedIds], v === NO_GROUP ? null : v)}
            className="w-[190px]"
            placeholder="Chuyển vào nhóm…"
            options={[
              ...groups.map((g) => ({
                value: g.id,
                label: `${g.icon || '●'} ${g.name}`,
              })),
              { value: NO_GROUP, label: '— Không nhóm —' },
            ]}
          />
          <button
            onClick={() => setSelectedIds(new Set())}
            disabled={movingTo}
            className="text-[13.5px] text-muted hover:text-white px-2 disabled:opacity-40"
          >
            Bỏ chọn
          </button>
        </div>
      )}

      {groupDialog && (
        <GroupDialog
          group={groupDialog.group}
          profiles={profiles}
          onClose={() => setGroupDialog(null)}
          onSaved={() => {
            setGroupDialog(null)
            onReload()
          }}
        />
      )}
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
      {confirmingDelAll && (
        <ConfirmDialog
          title="Xóa toàn bộ hồ sơ"
          message={`Xóa TOÀN BỘ ${profiles.length} hồ sơ và thư mục dữ liệu (session, cookie…) của chúng?\nHành động này KHÔNG thể khôi phục.`}
          confirmText={`Xóa ${profiles.length} hồ sơ`}
          onConfirm={removeAll}
          onCancel={() => setConfirmingDelAll(false)}
        />
      )}
    </div>
  )
}
