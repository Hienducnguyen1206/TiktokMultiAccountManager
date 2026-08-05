import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from '../../components/Avatar'
import { GroupMark } from '../../components/GroupMark'
import { loadCollapsedGroups, saveCollapsedGroups, NO_GROUP } from '../../components/groupStyle'
import { Select } from '../../components/Select'
import { Toggle } from '../../components/Toggle'
import { confirmDialog, showToast } from '../../components/uiDialogs'
import type {
  AccountPrivacy,
  AccountPrivacyPatch,
  AudienceScope,
  Profile,
  TiktokAccount,
  TiktokVideo,
  VideoPrivacy
} from '@shared/types'

const PRIVACY_LABEL: Record<VideoPrivacy, string> = {
  public: 'Mọi người',
  friends: 'Bạn bè',
  private: 'Chỉ mình tôi'
}

/** Đúng hai lựa chọn TikTok web đưa ra — bản điện thoại còn "Không ai", web không có. */
const AUDIENCE_OPTIONS = [
  { value: 'everyone', label: 'Mọi người' },
  { value: 'friends', label: 'Bạn bè' }
]

const PRIVACY_FIELDS = ['privateAccount', 'comment', 'duet'] as const

// Khoá `duet` giữ nguyên tên của TikTok để khớp chỗ đọc/ghi; chỉ chữ hiện ra là
// theo cách gọi của mình.
const PRIVACY_FIELD_LABEL: Record<keyof AccountPrivacyPatch, string> = {
  privateAccount: 'Tài khoản riêng tư',
  comment: 'Quyền bình luận',
  duet: 'Quyền đăng lại'
}

const NO_PRIVACY: AccountPrivacy = { privateAccount: null, comment: null, duet: null }

/**
 * Nguyên văn điều TikTok nói trong hộp xác nhận xóa của chính nó.
 *
 * Trước đây app ghi "KHÔNG thể khôi phục" — sai. Dò ra mới biết còn 30 ngày để
 * lấy lại, và người dùng cần biết đúng mức độ nghiêm trọng, không hơn không kém.
 */
const RESTORE_NOTE =
  'TikTok cho khôi phục trong 30 ngày qua Trung tâm hoạt động > Đã xóa gần đây. Sau đó mới mất hẳn.'

/** Tài khoản vài trăm video thì dựng hết một lúc vừa chậm vừa không đọc nổi. */
const PAGE_SIZE = 50

/** Thay đổi đang chờ lưu của một profile. */
interface VideoEdits {
  /** id video → quyền riêng tư mới. */
  privacy: Record<string, VideoPrivacy>
  /** id video đã đánh dấu xóa. */
  remove: string[]
}
const NO_EDITS: VideoEdits = { privacy: {}, remove: [] }

/** Chỉ sắp theo lượt xem — hai chiều, không sắp theo cột nào khác. */
const SORT_OPTIONS = [
  { value: 'desc', label: '↓ Lượt xem giảm dần' },
  { value: 'asc', label: '↑ Lượt xem tăng dần' }
]

function fmt(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('en-US')
}

/** Tên file cuối đường dẫn — hiện cả đường dẫn Windows thì dài và không cần. */
function fileName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/** Một ô chỉ số ở đầu trang (Follower / Đã follow / Lượt thích). */
function Stat({ label, value }: { label: string; value: number | null }): JSX.Element {
  return (
    // min-w rộng hơn con số dài nhất thường gặp: bề rộng thẻ bám theo nội dung,
    // nên khi dữ liệu về, "—" thành "1,234,567" là cả hàng thẻ giãn ra và xô nhau.
    <div className="bg-card border border-borderSoft rounded-[12px] px-4 py-3 min-w-[148px]">
      <div className="text-[12px] text-muted uppercase tracking-wide">{label}</div>
      <div className="text-[20px] font-bold tabular-nums mt-0.5">{fmt(value)}</div>
    </div>
  )
}

/**
 * Tab quản lý sâu một tài khoản TikTok: chỉ số tài khoản và danh sách video kèm
 * thao tác từng video.
 *
 * Dữ liệu lấy từ TikTok Studio — chỉ số ở trang chủ Studio, danh sách video ở
 * trang Nội dung (đã dò thực tế: cột Lượt xem / Lượt thích / Bình luận / Quyền
 * riêng tư, và quyền riêng tư sửa được ngay trên hàng).
 *
 * Thao tác trên bảng video chỉ ĐÁNH DẤU, không gửi đi ngay: sửa quyền riêng tư,
 * đánh dấu xóa, làm hàng loạt — rồi một nút Lưu chạy tất cả trong MỘT phiên
 * trình duyệt, một nút Hoàn tác bỏ sạch. Mỗi lần mở profile tốn khoảng 10 giây
 * khởi động Chromium nên áp dụng ngay từng thao tác là bắt người dùng chờ nhiều
 * lần vô ích.
 *
 * Cả thanh header cũng vậy: đổi tên và đổi ảnh chỉ đánh dấu, ảnh mới hiện ngay
 * trong khung avatar để xem trước nhưng chưa tải lên TikTok cho tới khi bấm Lưu.
 */
export function ManagerTab({ profiles }: { profiles: Profile[] }): JSX.Element {
  const [selId, setSelId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  // Dữ liệu sống ở tiến trình chính (mất khi tắt app). Bản sao ở đây chỉ để render;
  // đổi tab rồi quay lại thì hỏi lại main chứ không tải lại từ TikTok.
  const [accounts, setAccounts] = useState<Record<string, TiktokAccount>>({})
  const [videoQ, setVideoQ] = useState('')
  const [privacyFilter, setPrivacyFilter] = useState<'all' | VideoPrivacy>('all')
  // Sửa quyền riêng tư nhưng CHƯA gửi đi, giữ riêng theo từng profile để đổi
  // tài khoản qua lại không mất phần đang sửa dở.
  const [drafts, setDrafts] = useState<Record<string, AccountPrivacyPatch>>({})
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Giữ dạng chuỗi để phân biệt "bỏ trống" với số 0.
  const [underViews, setUnderViews] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  // Thay đổi video CHƯA gửi đi, giữ riêng theo profile. Sửa thoải mái rồi mới
  // bấm Lưu một lần — mỗi lần mở profile tốn khoảng 10 giây khởi động Chromium,
  // áp dụng ngay từng thao tác thì sửa năm thứ là chờ năm lần.
  const [edits, setEdits] = useState<Record<string, VideoEdits>>({})
  /** Toạ độ menu chuột phải trên bảng video. null = đang đóng. */
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  /** Hàng bấm gần nhất — mốc để Shift chọn cả khoảng. */
  const [anchor, setAnchor] = useState<string | null>(null)
  /** Ảnh đại diện đã chọn nhưng CHƯA tải lên — chờ nút Lưu như mọi thay đổi khác. */
  const [avatarPick, setAvatarPick] = useState<{ path: string; dataUrl: string } | null>(null)
  /** Ảnh đã lưu thành công trong phiên này. Giữ lại để khung avatar không quay
   *  về ảnh cũ ngay sau khi lưu — bản ghi profile chỉ cập nhật ở lần đồng bộ sau. */
  const [avatarSaved, setAvatarSaved] = useState<string | null>(null)

  useEffect(() => window.hnv.onManagerProgress((_id, msg) => setProgress(msg)), [])

  // Menu chuột phải đóng khi bấm ra ngoài, nhấn Escape, hoặc cuộn.
  useEffect(() => {
    if (!ctx) return
    const close = (): void => setCtx(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setCtx(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [ctx])

  // Lấy lại dữ liệu đã tải mỗi khi đổi tài khoản đang xem.
  useEffect(() => {
    if (!selId || accounts[selId]) return
    window.hnv.manager
      .get(selId)
      .then((a) => {
        if (a) setAccounts((prev) => ({ ...prev, [selId]: a }))
      })
      .catch(() => {
        /* chưa có gì để lấy — không phải lỗi đáng báo */
      })
  }, [selId, accounts])

  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsedGroups)
  const toggleGroup = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveCollapsedGroups(next)
      return next
    })

  /** Cột chọn tài khoản gom theo nhóm, "Không nhóm" xuống cuối — cùng cách với
   *  tab Profile và tab Analytics, và dùng chung trạng thái thu/mở với chúng. */
  const sections = useMemo(() => {
    const t = q.trim().toLowerCase()
    const filtered = t ? profiles.filter((p) => p.name.toLowerCase().includes(t)) : profiles
    const byGroup = new Map<string, Profile[]>()
    for (const p of filtered) {
      const key = p.groupId ?? NO_GROUP
      if (!byGroup.has(key)) byGroup.set(key, [])
      byGroup.get(key)!.push(p)
    }
    const named = [...byGroup.entries()]
      .filter(([k]) => k !== NO_GROUP)
      .sort((a, b) => (a[1][0].groupName ?? '').localeCompare(b[1][0].groupName ?? '', 'vi'))
    const loose = byGroup.get(NO_GROUP)
    return [
      ...named.map(([key, items]) => ({ key, items, head: items[0] as Profile | null })),
      ...(loose ? [{ key: NO_GROUP, items: loose, head: null }] : [])
    ]
  }, [profiles, q])

  const totalListed = sections.reduce((n, s) => n + s.items.length, 0)

  const sel = profiles.find((p) => p.id === selId) ?? null
  const acc = selId ? accounts[selId] : undefined

  const videos = useMemo(() => {
    let arr: TiktokVideo[] = acc?.videos ?? []
    if (privacyFilter !== 'all') arr = arr.filter((v) => v.privacy === privacyFilter)
    // "dưới X" = nhỏ hơn hẳn X, không lấy đúng bằng.
    if (underViews !== '') arr = arr.filter((v) => v.views < Number(underViews))
    const t = videoQ.trim().toLowerCase()
    return t ? arr.filter((v) => v.title.toLowerCase().includes(t)) : arr
  }, [acc, videoQ, privacyFilter, underViews])

  const hasFilter = privacyFilter !== 'all' || underViews !== '' || videoQ.trim() !== ''
  const clearFilters = (): void => {
    setPrivacyFilter('all')
    setUnderViews('')
    setVideoQ('')
  }

  const sorted = useMemo(() => {
    const sign = sortDir === 'asc' ? 1 : -1
    return [...videos].sort((a, b) => sign * (a.views - b.views))
  }, [videos, sortDir])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  // Lọc hẹp lại có thể làm trang hiện tại biến mất — kẹp lại thay vì hiện trang trống.
  const safePage = Math.min(page, pageCount - 1)
  const pageItems = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  // Đổi bộ lọc hay cách sắp xếp thì về trang đầu; đổi tài khoản thì bỏ luôn phần
  // đang chọn, để không lỡ tay thao tác hàng loạt lên nhầm tài khoản.
  useEffect(() => setPage(0), [videoQ, privacyFilter, underViews, sortDir])
  useEffect(() => {
    setPage(0)
    setPicked(new Set())
    // Ảnh là thứ nhìn thấy ngay trên khung avatar — mang nó sang tài khoản khác
    // thì trông như tài khoản đó đã đổi ảnh, nên phải xoá khi đổi profile.
    setAvatarPick(null)
    setAvatarSaved(null)
  }, [selId])

  /**
   * Chọn hàng theo lối trình quản lý tệp: bấm thường chọn một, Ctrl bật/tắt từng
   * cái, Shift chọn cả khoảng.
   *
   * Khoảng tính trên `sorted` (toàn bộ tập đã lọc) chứ không trên trang đang
   * xem: neo có thể nằm ở trang trước, và người dùng mong "từ đó tới đây" là
   * liền mạch chứ không đứt ở ranh giới trang.
   */
  const clickRow = (e: React.MouseEvent, id: string): void => {
    // Bấm trúng ô quyền riêng tư hay nút xóa thì để chúng tự xử lý.
    if ((e.target as HTMLElement).closest('button')) return

    if (e.shiftKey && anchor) {
      const from = sorted.findIndex((v) => v.id === anchor)
      const to = sorted.findIndex((v) => v.id === id)
      if (from >= 0 && to >= 0) {
        const [a, b] = from <= to ? [from, to] : [to, from]
        setPicked(new Set(sorted.slice(a, b + 1).map((v) => v.id)))
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setPicked((prev) => {
        const n = new Set(prev)
        if (n.has(id)) n.delete(id)
        else n.add(id)
        return n
      })
    } else {
      setPicked(new Set([id]))
    }
    setAnchor(id)
  }

  const toggleSort = (): void => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))

  const notWired = (what: string): void =>
    showToast(`${what}: phần nối với TikTok chưa được bật ở bước này.`, 'error')

  // ── Thay đổi video: đánh dấu trước, lưu sau ───────────────────────────────
  const myEdits: VideoEdits = (selId && edits[selId]) || NO_EDITS
  const removeSet = useMemo(() => new Set(myEdits.remove), [myEdits.remove])
  const pendingCount = Object.keys(myEdits.privacy).length + myEdits.remove.length

  const stage = (fn: (e: VideoEdits) => VideoEdits): void => {
    if (!selId) return
    setEdits((prev) => ({ ...prev, [selId]: fn(prev[selId] ?? NO_EDITS) }))
  }

  /** Quyền riêng tư đang hiện: bản sửa dở nếu có, không thì giá trị đọc từ TikTok. */
  const shownPrivacy = (v: TiktokVideo): VideoPrivacy => myEdits.privacy[v.id] ?? v.privacy

  /** Đánh dấu quyền riêng tư mới. Chọn trùng giá trị gốc thì bỏ đánh dấu luôn,
   *  để không gửi đi một thao tác không đổi gì. */
  const stagePrivacy = (ids: string[], next: VideoPrivacy): void =>
    stage((e) => {
      const p = { ...e.privacy }
      for (const id of ids) {
        if (acc?.videos.find((v) => v.id === id)?.privacy === next) delete p[id]
        else p[id] = next
      }
      return { ...e, privacy: p }
    })

  const toggleRemove = (id: string): void =>
    stage((e) => ({
      ...e,
      remove: e.remove.includes(id) ? e.remove.filter((x) => x !== id) : [...e.remove, id]
    }))

  const bulkDelete = (): void => {
    if (!selId || picked.size === 0) return
    stage((e) => ({ ...e, remove: [...new Set([...e.remove, ...picked])] }))
    setPicked(new Set())
  }

  const bulkPrivacy = (next: VideoPrivacy): void => {
    if (!selId || picked.size === 0) return
    stagePrivacy([...picked], next)
    setPicked(new Set())
  }

  /** Bỏ MỌI thay đổi chưa lưu của tab: video, quyền riêng tư tài khoản, tên. */
  const resetAll = (): void => {
    if (!selId) return
    setEdits((prev) => ({ ...prev, [selId]: NO_EDITS }))
    setDrafts((prev) => ({ ...prev, [selId]: {} }))
    setNameDraft(acc?.displayName ?? '')
    setAvatarPick(null)
    setRenaming(false)
    setPicked(new Set())
  }

  /**
   * Gửi TẤT CẢ thay đổi đang chờ của tab xuống engine trong MỘT phiên trình
   * duyệt: tên hiển thị, quyền riêng tư tài khoản, và mọi thay đổi video.
   */
  const saveAll = async (): Promise<void> => {
    if (!sel || totalPending === 0) return
    const nChange = Object.keys(myEdits.privacy).length
    const nRemove = myEdits.remove.length
    const lines = [
      nameDirty ? `• Đổi tên hiển thị: "${nameDraft.trim()}"` : '',
      avatarPick ? `• Đổi ảnh đại diện: ${fileName(avatarPick.path)}` : '',
      ...dirty.map((k) => {
        const v = draft[k]
        const shown = typeof v === 'boolean' ? (v ? 'Bật' : 'Tắt') : v === 'friends' ? 'Bạn bè' : 'Mọi người'
        return `• ${PRIVACY_FIELD_LABEL[k]}: ${shown}`
      }),
      nChange ? `• Đổi quyền riêng tư: ${nChange} video` : '',
      nRemove ? `• Xóa: ${nRemove} video` : ''
    ]
      .filter(Boolean)
      .join('\n')
    const ok = await confirmDialog({
      title: 'Lưu thay đổi lên TikTok',
      message:
        `Tài khoản "${sel.name}":\n${lines}\n\n` +
        (nRemove ? `${RESTORE_NOTE}\n\n` : '') +
        'Sẽ mở trình duyệt của profile này để thao tác.',
      confirmText: `💾 Lưu ${totalPending} thay đổi`
    })
    if (!ok) return

    const accPatch: AccountPrivacyPatch = {}
    for (const k of dirty) Object.assign(accPatch, { [k]: draft[k] })

    setLoading(true)
    setProgress('Đang chuẩn bị…')
    try {
      const r = await window.hnv.manager.applyAll(sel.id, {
        displayName: nameDirty ? nameDraft.trim() : undefined,
        avatarPath: avatarPick?.path,
        privacy: dirty.length ? accPatch : undefined,
        videos: pendingCount ? { privacy: myEdits.privacy, remove: myEdits.remove } : undefined
      })
      const done = new Set(r.changed)
      const gone = new Set(r.removed)
      // Bảng chỉ đổi theo thứ THẬT SỰ làm được. Thứ hỏng vẫn nằm lại dạng đang
      // chờ để người dùng thấy và thử lại, không bị nuốt mất.
      setAccounts((prev) => {
        const cur = prev[sel.id]
        if (!cur) return prev
        return {
          ...prev,
          [sel.id]: {
            ...cur,
            displayName: r.name ?? cur.displayName,
            privacy: r.privacy ?? cur.privacy,
            videos: cur.videos
              .filter((v) => !gone.has(v.id))
              .map((v) => (done.has(v.id) ? { ...v, privacy: myEdits.privacy[v.id] } : v))
          }
        }
      })
      setEdits((prev) => {
        const cur = prev[sel.id] ?? NO_EDITS
        const p = { ...cur.privacy }
        for (const id of done) delete p[id]
        return { ...prev, [sel.id]: { privacy: p, remove: cur.remove.filter((id) => !gone.has(id)) } }
      })
      // Quyền riêng tư tài khoản: giữ lại đúng mục nào TikTok chưa nhận.
      if (r.privacy) {
        const after = r.privacy
        setDrafts((prev) => {
          const cur = prev[sel.id] ?? {}
          const next: AccountPrivacyPatch = {}
          for (const k of PRIVACY_FIELDS) if (cur[k] !== undefined && cur[k] !== after[k]) next[k] = cur[k] as never
          return { ...prev, [sel.id]: next }
        })
      }
      if (r.name) {
        setRenaming(false)
        setNameDraft(r.name)
      }
      // Chỉ bỏ ảnh đang chờ khi TikTok thật sự nhận; hỏng thì giữ để thử lại.
      // Lưu xong thì ảnh vừa chọn thành ảnh đang dùng — giữ lại để khung avatar
      // không nhảy về ảnh cũ, vì bản ghi profile chỉ đổi ở lần đồng bộ sau.
      if (r.avatarDone && avatarPick) {
        setAvatarSaved(avatarPick.dataUrl)
        setAvatarPick(null)
      }

      if (r.ok) showToast(`${sel.name}: đã lưu ${totalPending} thay đổi`, 'success')
      else showToast(r.reason ?? r.problems.join(' · ') ?? 'Không lưu được', 'error')
    } catch (e: any) {
      showToast(e?.message ?? 'Lỗi lưu thay đổi', 'error')
    } finally {
      setLoading(false)
      setProgress('')
    }
  }



  // ── Quyền riêng tư cấp tài khoản ──────────────────────────────────────────
  const draft = (selId && drafts[selId]) || {}
  const accPriv = acc?.privacy ?? NO_PRIVACY
  /** Giá trị đang hiện: bản sửa dở nếu có, không thì giá trị đọc được từ TikTok. */
  const priv: AccountPrivacy = {
    privateAccount: draft.privateAccount ?? accPriv.privateAccount,
    comment: draft.comment ?? accPriv.comment,
    duet: draft.duet ?? accPriv.duet
  }
  const dirty = acc ? PRIVACY_FIELDS.filter((k) => draft[k] !== undefined && draft[k] !== accPriv[k]) : []

  /** Tên hiển thị đã sửa nhưng chưa lưu. */
  const nameDirty = !!acc && nameDraft.trim() !== '' && nameDraft.trim() !== (acc.displayName ?? '')
  /** Tổng số thứ đang chờ lưu của CẢ tab — nút Lưu/Hoàn tác đếm theo con số này. */
  const totalPending = pendingCount + dirty.length + (nameDirty ? 1 : 0) + (avatarPick ? 1 : 0)

  const editPrivacy = <K extends keyof AccountPrivacyPatch>(k: K, v: AccountPrivacyPatch[K]): void => {
    if (!selId) return
    setDrafts((prev) => ({ ...prev, [selId]: { ...prev[selId], [k]: v } }))
  }


  const load = async (): Promise<void> => {
    if (!sel) return
    setLoading(true)
    setProgress('Đang chuẩn bị…')
    try {
      const r = await window.hnv.manager.load(sel.id)
      if (r.ok && r.account) {
        setAccounts((prev) => ({ ...prev, [sel.id]: r.account! }))
        setDrafts((prev) => ({ ...prev, [sel.id]: {} })) // vừa đọc mới → bỏ bản sửa dở cũ
        showToast(`${sel.name}: đã tải ${r.account.videos.length} video`, 'success')
      } else {
        showToast(`${sel.name}: ${r.reason ?? 'không tải được'}`, 'error')
      }
    } catch (e: any) {
      showToast(e?.message ?? 'Lỗi tải thông tin', 'error')
    } finally {
      setLoading(false)
      setProgress('')
    }
  }

  /** Một dòng lệnh trong menu chuột phải. */
  const CtxItem = ({
    label,
    onPick,
    danger
  }: {
    label: string
    onPick: () => void
    danger?: boolean
  }): JSX.Element => (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        onPick()
        setCtx(null)
      }}
      className={
        'w-full text-left px-3 py-2 rounded-[7px] text-[13.5px] ' +
        (danger ? 'text-[#f87171] hover:bg-[rgba(248,113,113,.12)]' : 'text-[#c7c8d4] hover:bg-[rgba(99,102,241,.14)]')
      }
    >
      {label}
    </button>
  )

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-[22px] pt-[18px] pb-3.5 text-[21px] font-bold shrink-0">🗂️ Profile Manager</div>

      {/* Menu chuột phải cho tập video đang chọn. Qua portal ra <body> vì cùng lý
          do với Select: thẻ bọc tab chạy animation nên là containing block của
          position:fixed, ở trong đó thì toạ độ chuột lệch đi bằng bề rộng sidebar. */}
      {ctx &&
        createPortal(
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              // Kẹp vào trong màn hình để menu mở gần mép không bị cụt.
              left: Math.min(ctx.x, window.innerWidth - 232),
              top: Math.min(ctx.y, window.innerHeight - 250)
            }}
            className="fixed z-[90] w-[220px] p-1.5 rounded-[10px] bg-[#14151c] border border-[#2e3040] shadow-[0_18px_44px_-12px_rgba(0,0,0,.8)]"
          >
            <div className="px-3 py-1.5 text-[12px] text-muted">Đã chọn {picked.size} video</div>
            <div className="my-1 h-px bg-[#23242e]" />
            <div className="px-3 py-1 text-[11.5px] uppercase tracking-wide text-subtle">Đặt quyền riêng tư</div>
            <CtxItem label={PRIVACY_LABEL.public} onPick={() => bulkPrivacy('public')} />
            <CtxItem label={PRIVACY_LABEL.friends} onPick={() => bulkPrivacy('friends')} />
            <CtxItem label={PRIVACY_LABEL.private} onPick={() => bulkPrivacy('private')} />
            <div className="my-1 h-px bg-[#23242e]" />
            <CtxItem label="🗑 Đánh dấu xóa" onPick={bulkDelete} danger />
            <div className="my-1 h-px bg-[#23242e]" />
            <CtxItem
              label={`Chọn cả ${sorted.length} video đang lọc`}
              onPick={() => setPicked(new Set(sorted.map((v) => v.id)))}
            />
            <CtxItem label="Bỏ chọn" onPick={() => setPicked(new Set())} />
          </div>,
          document.body
        )}

      <div className="flex-1 flex min-w-0 min-h-0">
        {/* ── Cột trái: chọn tài khoản ─────────────────────────────────── */}
        <div className="w-[260px] shrink-0 border-r border-borderSoft flex flex-col min-h-0">
          <div className="px-3 pb-2.5">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="🔍 Tìm profile…"
              className="w-full bg-[#101117] border border-border rounded-[10px] px-3 py-2 text-[13.5px] outline-none focus:border-[#3a3d6b]"
            />
          </div>
          <div className="flex-1 overflow-auto hv-scroll px-2 pb-3">
            {totalListed === 0 ? (
              <div className="text-muted text-[13px] text-center mt-6">Không có profile nào.</div>
            ) : (
              sections.map((sec) => {
                const isCollapsed = collapsed.has(sec.key)
                return (
                  <Fragment key={sec.key}>
                    <div
                      onClick={() => toggleGroup(sec.key)}
                      className="mt-1.5 mb-1 flex items-center gap-1.5 px-2 py-1.5 rounded-[9px] cursor-pointer select-none bg-[#12131b] border border-borderSoft hover:border-[#2b2d45]"
                    >
                      <span className="text-subtle w-3 text-center text-[12px]">{isCollapsed ? '▸' : '▾'}</span>
                      <GroupMark icon={sec.head?.groupIcon} color={sec.head?.groupColor} size={12} />
                      <span
                        className={
                          'min-w-0 text-[12px] font-semibold truncate ' + (sec.head ? '' : 'text-subtle')
                        }
                      >
                        {sec.head?.groupName ?? 'Không nhóm'}
                      </span>
                      <span className="ml-auto text-[11px] text-muted">{sec.items.length}</span>
                    </div>
                    {!isCollapsed &&
                      sec.items.map((p) => {
                        const on = p.id === selId
                        return (
                          <button
                            key={p.id}
                            onClick={() => setSelId(p.id)}
                            className={
                              'w-full text-left my-0.5 pl-3 pr-2.5 py-2 rounded-[10px] flex items-center gap-2.5 border transition ' +
                              (on
                                ? 'border-[rgba(129,140,248,.35)] bg-[linear-gradient(100deg,rgba(129,140,248,.18),rgba(34,211,238,.10))]'
                                : 'border-transparent hover:bg-surface')
                            }
                          >
                            <Avatar src={p.avatar} name={p.name} size={28} />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-semibold truncate">{p.name}</span>
                              <span
                                className={
                                  'block text-[11px] truncate ' + (p.loggedIn ? 'text-ok' : 'text-muted')
                                }
                              >
                                {p.loggedIn ? 'đã đăng nhập' : 'chưa đăng nhập'}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                  </Fragment>
                )
              })
            )}
          </div>
        </div>

        {/* ── Cột phải: chi tiết tài khoản ─────────────────────────────── */}
        {!sel ? (
          <div className="flex-1 flex items-center justify-center text-muted">
            <div className="text-center">
              <div className="text-xl font-bold mb-2">Chưa chọn tài khoản</div>
              <div>Chọn một profile ở cột bên trái để xem thông tin sâu.</div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <div className="px-[22px] py-4 border-b border-borderSoft flex items-center gap-3.5">
              {/* Ưu tiên ảnh đang chờ lưu → ảnh vừa lưu trong phiên → ảnh cũ.
                  Bấm Hoàn tác xoá ảnh đang chờ nên khung tự trở về ảnh cũ. */}
              <span className="relative shrink-0">
                <Avatar src={avatarPick?.dataUrl || avatarSaved || sel.avatar} name={sel.name} size={54} />
                {avatarPick && (
                  <span
                    title="Ảnh mới, chưa tải lên TikTok"
                    className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-[#0b0c12] border border-[#1d5a41] text-ok text-[10px] flex items-center justify-center"
                  >
                    ●
                  </span>
                )}
              </span>
              <div className="min-w-0">
                {/* Sửa tại chỗ: app chưa có hộp nhập chữ dùng chung, mà dựng thêm
                    một cái cho đúng một ô thì thừa.

                    h-9 cho CẢ HAI trạng thái: ô nhập cao 36px còn dòng chữ chỉ
                    ~24px, không ghim chiều cao thì mỗi lần bấm Đổi tên là cả
                    header giãn ra và đẩy toàn bộ nội dung bên dưới xuống. */}
                {renaming ? (
                  <div className="h-9 flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setRenaming(false)
                        if (e.key === 'Escape') {
                          setNameDraft(acc?.displayName ?? '')
                          setRenaming(false)
                        }
                      }}
                      placeholder="Tên hiển thị trên TikTok"
                      className="w-[220px] h-9 bg-[#101117] border border-border rounded-[9px] px-2.5 text-[15px] font-bold outline-none focus:border-[#3a3d6b]"
                    />
                    {/* ✓ chỉ đóng ô nhập — tên mới nằm chờ cùng mọi thay đổi khác
                        cho tới khi bấm Lưu. ✕ trả về giá trị gốc. */}
                    <button
                      onClick={() => setRenaming(false)}
                      title="Giữ tên này, lưu sau"
                      className="h-9 px-2.5 rounded-[9px] accent-grad text-[#0a0b10] font-bold text-[13px]"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => {
                        setNameDraft(acc?.displayName ?? '')
                        setRenaming(false)
                      }}
                      title="Bỏ sửa tên"
                      className="h-9 px-2.5 rounded-[9px] bg-surface border border-border text-[#c7c8d4] text-[13px]"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="h-9 flex items-center text-[18px] font-bold truncate">
                    {sel.name}
                    {acc?.displayName && (
                      <span className="ml-2 text-[13px] font-normal text-muted shrink-0">
                        TikTok: {nameDirty ? nameDraft.trim() : acc.displayName}
                        {nameDirty && <span className="ml-1 text-accent2">• chưa lưu</span>}
                      </span>
                    )}
                  </div>
                )}
                <div className="text-[12.5px] text-muted truncate">
                  {loading && progress
                    ? `⏳ ${progress}`
                    : avatarPick
                      ? `🖼 Ảnh mới chờ lưu: ${fileName(avatarPick.path)}`
                      : acc?.fetchedAt
                      ? `Tải lúc ${new Date(acc.fetchedAt).toLocaleTimeString('vi-VN')} · ${acc.videos.length} video`
                      : 'Chưa tải thông tin lần nào'}
                </div>
              </div>
              {/* Hai nút sửa hồ sơ nằm SÁT tên vì chúng tác động lên chính khối
                  đó; cụm bên phải là các lệnh của cả tab. */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => {
                    setNameDraft(acc?.displayName ?? '')
                    setRenaming(true)
                  }}
                  disabled={loading || !sel.loggedIn || renaming}
                  title="Đổi tên hiển thị trên TikTok"
                  aria-label="Đổi tên hiển thị"
                  className="w-10 h-10 inline-flex items-center justify-center text-[15px] rounded-[10px] bg-surface border border-border text-[#c7c8d4] hover:border-[#3a3d6b] disabled:opacity-40"
                >
                  ✏️
                </button>
                {/* Chọn ảnh xong KHÔNG tải lên ngay — nằm chờ cùng mọi thay đổi
                    khác cho tới khi bấm Lưu, như tên hiển thị và quyền riêng tư. */}
                <button
                  onClick={async () => {
                    const p = await window.hnv.manager.pickAvatar()
                    if (p) setAvatarPick(p)
                  }}
                  disabled={loading || !sel.loggedIn}
                  title={
                    avatarPick
                      ? `Đang chờ lưu: ${fileName(avatarPick.path)} — bấm để chọn ảnh khác`
                      : 'Chọn ảnh đại diện mới (tải lên khi bấm Lưu)'
                  }
                  aria-label="Đổi ảnh đại diện"
                  className={
                    'w-10 h-10 inline-flex items-center justify-center text-[15px] rounded-[10px] border disabled:opacity-40 ' +
                    (avatarPick
                      ? 'bg-[rgba(52,211,153,.14)] border-[#1d5a41] text-ok'
                      : 'bg-surface border-border text-[#c7c8d4] hover:border-[#3a3d6b]')
                  }
                >
                  🖼
                </button>
              </div>

              <div className="ml-auto flex items-center gap-2 shrink-0">
                <button
                  onClick={saveAll}
                  disabled={loading || totalPending === 0}
                  title={totalPending ? 'Ghi mọi thay đổi lên TikTok' : 'Chưa có thay đổi nào'}
                  // w cố định: nhãn đổi từ "Lưu" sang "Lưu 12 thay đổi" mỗi lần
                  // tích một dòng, không ghim bề rộng thì cả hàng nhúc nhích theo.
                  className="h-10 w-[152px] inline-flex items-center justify-center ok-grad text-[#062018] font-bold text-[13px] rounded-[10px] px-2 disabled:opacity-40"
                >
                  {totalPending ? `💾 Lưu ${totalPending} thay đổi` : '💾 Lưu'}
                </button>
                <button
                  onClick={resetAll}
                  disabled={loading || totalPending === 0}
                  title="Bỏ mọi thay đổi chưa lưu"
                  className="h-10 w-[152px] inline-flex items-center justify-center warn-grad text-[#2a1608] font-bold text-[13px] rounded-[10px] px-2 disabled:opacity-40"
                >
                  ↺ Hoàn tác
                </button>
                <button
                  onClick={load}
                  disabled={loading || !sel.loggedIn}
                  title={sel.loggedIn ? undefined : 'Profile chưa đăng nhập TikTok'}
                  className="h-10 w-[152px] inline-flex items-center justify-center accent-grad text-[#0a0b10] font-bold text-[13px] rounded-[10px] px-2 disabled:opacity-40"
                >
                  {loading ? '⏳ Đang tải…' : '⟳ Tải thông tin'}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto hv-scroll px-[22px] py-4">
              <div className="flex gap-2.5 mb-4">
                <Stat label="Follower" value={acc?.followers ?? null} />
                <Stat label="Đã follow" value={acc?.following ?? null} />
                <Stat label="Lượt thích" value={acc?.likes ?? null} />
                <Stat label="Video" value={acc ? acc.videos.length : null} />
              </div>

              {/* Quyền riêng tư của CẢ TÀI KHOẢN — khác cột quyền riêng tư từng
                  video ở bảng bên dưới. */}
              <div className="bg-card border border-borderSoft rounded-[14px] px-4 py-3.5 mb-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="text-[13.5px] font-semibold shrink-0">🔒 Quyền riêng tư tài khoản</div>
                  <div className="min-w-0 text-[12px] text-muted truncate">
                    {acc ? 'Áp dụng cho cả tài khoản' : 'Chưa tải — bấm ⟳ Tải thông tin để đọc'}
                  </div>
                  {/* Không có nút Lưu riêng ở đây nữa: cả tab dùng chung một nút
                      Lưu dưới thanh công cụ video. Chỉ báo còn mấy mục chưa lưu. */}
                  <span
                    className={
                      'ml-auto shrink-0 text-[12px] ' + (dirty.length ? 'text-accent2' : 'invisible')
                    }
                  >
                    {dirty.length} mục chưa lưu
                  </span>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1 flex items-center gap-3 bg-[#0e0f15] border border-borderSoft rounded-[11px] px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold">Tài khoản riêng tư</div>
                      <div className="text-[11.5px] text-muted truncate">Chỉ người được duyệt mới follow và xem được</div>
                    </div>
                    {/* h-10 = chiều cao của Select ở hai thẻ bên cạnh. Ô giá trị
                        phải cao bằng nhau ở CẢ hai trạng thái, nếu không thì lúc
                        chưa tải ba thẻ thấp lè tè, tải xong lại cao vọt lên và
                        đẩy cả bảng video xuống. */}
                    <div className="ml-auto shrink-0 h-10 flex items-center justify-end">
                      {priv.privateAccount === null ? (
                        <span className="text-[12px] text-muted">—</span>
                      ) : (
                        <Toggle
                          on={priv.privateAccount}
                          onChange={(v) => editPrivacy('privateAccount', v)}
                          disabled={loading}
                        />
                      )}
                    </div>
                  </div>

                  {(['comment', 'duet'] as const).map((k) => (
                    <div
                      key={k}
                      className="flex-1 flex items-center gap-3 bg-[#0e0f15] border border-borderSoft rounded-[11px] px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold">{PRIVACY_FIELD_LABEL[k]}</div>
                        <div className="text-[11.5px] text-muted truncate">
                          {k === 'comment' ? 'Bình luận bài đăng của bạn' : 'Đăng lại nội dung của bạn'}
                        </div>
                      </div>
                      <div className="ml-auto shrink-0 h-10 w-[124px] flex items-center justify-end">
                        {priv[k] === null ? (
                          <span className="text-[12px] text-muted">—</span>
                        ) : (
                          <Select
                            value={priv[k] as string}
                            onChange={(v) => editPrivacy(k, v as AudienceScope)}
                            className="w-[124px]"
                            disabled={loading}
                            options={AUDIENCE_OPTIONS}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* flex-wrap phẳng MỘT cấp: không bọc cụm điều khiển vào một div
                  ml-auto+flex-wrap lồng bên trong, vì flex-wrap lồng trong một
                  item có margin-left:auto sẽ xuống dòng lệch trái thay vì thẳng
                  theo mép trái toolbar. mr-auto ở nhãn "Video" đạt cùng hiệu quả
                  đẩy cụm điều khiển sang phải mà không lồng cấp. Mỗi điều khiển
                  có shrink-0 để không bị bóp méo trước khi kịp xuống dòng. */}
              <div className="flex items-center gap-2 flex-wrap mb-2.5">
                {/* Luôn có phần đếm, kể cả khi chưa tải — trước đây nó chỉ hiện
                    sau khi có dữ liệu, nên lúc tải xong cả cụm nút bên phải bị
                    đẩy đi một đoạn. */}
                <div className="mr-auto shrink-0 text-[13px] text-subtle whitespace-nowrap">
                  Video{' '}
                  <span className="text-muted">
                    ·{' '}
                    {acc
                      ? `${videos.length}${hasFilter ? ` / ${acc.videos.length}` : ''} hiển thị`
                      : 'chưa tải'}
                  </span>
                  {/* Số đang chọn hiện ở đây thay cho thanh riêng — thanh đó cứ
                      hiện/ẩn là đẩy cả bảng lên xuống. */}
                  {picked.size > 0 && <span className="ml-1.5 text-accent2">· {picked.size} đã chọn</span>}
                </div>

                <Select
                  value={sortDir}
                  onChange={(v) => setSortDir(v as 'asc' | 'desc')}
                  className="w-[184px] shrink-0"
                  options={SORT_OPTIONS}
                />
                {/* h-10 = đúng chiều cao 40px cố định của Select (xem .hv-select
                    trong index.css) để hàng cùng chiều cao với nhau. */}
                <input
                  value={underViews}
                  onChange={(e) => setUnderViews(e.target.value.replace(/\D/g, ''))}
                  placeholder="Lượt xem dưới…"
                  inputMode="numeric"
                  title="Chỉ hiện video có lượt xem nhỏ hơn số này"
                  className="w-[132px] h-10 shrink-0 bg-[#101117] border border-border rounded-[10px] px-3 text-[13.5px] outline-none tabular-nums focus:border-[#3a3d6b] placeholder:text-subtle placeholder:font-normal"
                />
                <Select
                  value={privacyFilter}
                  onChange={(v) => setPrivacyFilter(v as 'all' | VideoPrivacy)}
                  className="w-[170px] shrink-0"
                  options={[
                    { value: 'all', label: 'Tất cả quyền riêng tư' },
                    { value: 'public', label: PRIVACY_LABEL.public },
                    { value: 'friends', label: PRIVACY_LABEL.friends },
                    { value: 'private', label: PRIVACY_LABEL.private }
                  ]}
                />
                <input
                  value={videoQ}
                  onChange={(e) => setVideoQ(e.target.value)}
                  placeholder="🔍 Tìm video…"
                  className="w-[180px] h-10 shrink-0 bg-[#101117] border border-border rounded-[10px] px-3 text-[13.5px] outline-none focus:border-[#3a3d6b]"
                />
                {/* Luôn dựng, chỉ khoá khi chưa lọc gì. Gắn/tháo theo điều kiện
                    thì lúc gõ ký tự đầu vào ô tìm là nút này chen vào và có thể
                    đẩy cả hàng công cụ xuống dòng. */}
                <button
                  onClick={clearFilters}
                  disabled={!hasFilter}
                  className="h-10 shrink-0 inline-flex items-center justify-center text-[13px] rounded-[10px] px-2.5 bg-surface border border-border text-[#c7c8d4] hover:border-[#3a3d6b] disabled:opacity-40"
                >
                  ✕ Bỏ lọc
                </button>
              </div>

              <div className="bg-card border border-borderSoft rounded-[14px] overflow-hidden">
                {!acc ? (
                  <div className="text-muted text-[14px] px-5 py-8 text-center">
                    Chưa có dữ liệu. Bấm <b className="text-accent2">⟳ Tải thông tin</b> để đọc từ TikTok.
                  </div>
                ) : videos.length === 0 ? (
                  <div className="text-muted text-[14px] px-5 py-8 text-center">Không có video nào khớp.</div>
                ) : (
                  <table className="w-full text-[14px]">
                    <thead className="text-muted text-left">
                      <tr>
                        {/* whitespace-nowrap ở mọi tiêu đề: bảng dùng table-layout
                            auto nên khi cột tên ăn hết chỗ, "Lượt xem" và "Bình
                            luận" bị bẻ làm hai dòng. Cấm xuống dòng thì trình
                            duyệt buộc phải chừa đủ bề ngang cho chúng. */}
                        <th className="px-4 py-3 font-semibold text-[12.5px] uppercase tracking-wide whitespace-nowrap">
                          Video
                        </th>
                        <th className="px-4 py-3 font-semibold text-[12.5px] uppercase tracking-wide w-[150px] text-center whitespace-nowrap">
                          Quyền riêng tư
                        </th>
                        {/* Chỉ cột này sắp được — bấm để đảo chiều, dùng chung
                            trạng thái với ô chọn trên thanh công cụ. */}
                        <th className="px-4 py-3 font-semibold text-[12.5px] w-[104px] text-center whitespace-nowrap">
                          <button onClick={toggleSort} className="uppercase tracking-wide hover:text-white">
                            Lượt xem<span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>
                          </button>
                        </th>
                        <th className="px-4 py-3 font-semibold text-[12.5px] uppercase tracking-wide w-[84px] text-center whitespace-nowrap">
                          Thích
                        </th>
                        <th className="px-4 py-3 font-semibold text-[12.5px] uppercase tracking-wide w-[104px] text-center whitespace-nowrap">
                          Bình luận
                        </th>
                        <th className="px-4 py-3 font-semibold text-[12.5px] uppercase tracking-wide w-[76px] text-center whitespace-nowrap">
                          Thao tác
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((v, i) => (
                        <tr
                          key={v.id}
                          // Chuột phải trên hàng CHƯA chọn thì chọn riêng nó —
                          // giống mọi trình quản lý tệp, tránh việc lệnh rơi vào
                          // một tập cũ mà người dùng đã quên mất.
                          onContextMenu={(e) => {
                            e.preventDefault()
                            if (!picked.has(v.id)) {
                              setPicked(new Set([v.id]))
                              setAnchor(v.id)
                            }
                            setCtx({ x: e.clientX, y: e.clientY })
                          }}
                          onClick={(e) => clickRow(e, v.id)}
                          // select-none: không có nó thì Shift+bấm sẽ bôi đen chữ
                          // trong bảng thay vì chọn hàng.
                          className={
                            'cursor-pointer select-none ' +
                            (removeSet.has(v.id)
                              ? 'bg-[rgba(248,113,113,.09)]'
                              : picked.has(v.id)
                                ? 'bg-[rgba(129,140,248,.10)]'
                                : i % 2 === 0
                                  ? 'bg-[#0e0f15] hover:bg-[#141520]'
                                  : 'hover:bg-[#141520]')
                          }
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              {/* Ảnh bìa dọc 9:16, đã nhúng sẵn dạng data URI nên
                                  không phát sinh request nào từ cửa sổ app. */}
                              <div className="w-[34px] h-[46px] shrink-0 rounded-[6px] overflow-hidden bg-[#181923] border border-borderSoft flex items-center justify-center">
                                {v.cover ? (
                                  <img src={v.cover} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <span className="text-[13px] text-subtle">🎞</span>
                                )}
                              </div>
                              <div className="min-w-0">
                                {/* Hẹp hơn trước (380px): cột tên càng rộng thì
                                    càng bóp các cột số, làm tiêu đề của chúng bị
                                    bẻ hai dòng. */}
                                <div
                                  className={
                                    'font-semibold truncate max-w-[280px] ' +
                                    (removeSet.has(v.id) ? 'line-through text-muted' : '')
                                  }
                                >
                                  {v.title}
                                </div>
                                <div className="text-[11.5px] text-muted mt-0.5">
                                  {removeSet.has(v.id) ? (
                                    <span className="text-[#f87171]">Sẽ xóa khi bấm Lưu</span>
                                  ) : (
                                    `${v.duration} · ${v.postedAt}`
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Select
                              value={shownPrivacy(v)}
                              onChange={(next) => stagePrivacy([v.id], next as VideoPrivacy)}
                              className={
                                'w-[136px] ' +
                                // Viền sáng = giá trị này đã đổi nhưng chưa lưu.
                                (myEdits.privacy[v.id] ? '!border-[#6366f1]' : '')
                              }
                              disabled={loading || removeSet.has(v.id)}
                              center
                              options={[
                                { value: 'public', label: PRIVACY_LABEL.public },
                                { value: 'friends', label: PRIVACY_LABEL.friends },
                                { value: 'private', label: PRIVACY_LABEL.private }
                              ]}
                            />
                          </td>
                          <td className="px-4 py-3 text-center tabular-nums">{fmt(v.views)}</td>
                          <td className="px-4 py-3 text-center tabular-nums">{fmt(v.likes)}</td>
                          <td className="px-4 py-3 text-center tabular-nums">{fmt(v.comments)}</td>
                          <td className="px-4 py-3 text-center">
                            {/* Chỉ biểu tượng: chữ "Xóa" lặp lại ở mọi hàng vừa
                                thừa vừa ăn bề ngang của các cột số. Đánh dấu rồi
                                thì đổi thành nút bỏ đánh dấu — xóa nhầm một cái
                                không phải mất cả tập đang sửa dở. */}
                            <button
                              onClick={() => toggleRemove(v.id)}
                              disabled={loading}
                              className={
                                'w-9 h-9 inline-flex items-center justify-center rounded-lg text-[15px] border disabled:opacity-40 ' +
                                (removeSet.has(v.id)
                                  ? 'bg-surface text-[#c7c8d4] border-border hover:border-[#3a3d6b]'
                                  : 'bg-[#3a1f1f] text-[#f87171] border-[#542c2c] hover:border-[#7a3c3c]')
                              }
                              title={removeSet.has(v.id) ? 'Bỏ đánh dấu xóa' : 'Đánh dấu xóa video này'}
                              aria-label={removeSet.has(v.id) ? 'Bỏ đánh dấu xóa' : 'Đánh dấu xóa video'}
                            >
                              {removeSet.has(v.id) ? '↺' : '🗑'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {pageCount > 1 && (
                // Phẳng một cấp + flex-wrap: tài khoản nhiều video ra nhiều nút
                // trang, cộng dồn có thể vượt bề rộng cột phải ở cửa sổ hẹp — để
                // cụm nút xuống dòng gọn thay vì tràn ra ngoài. mr-auto ở nhãn bên
                // trái thay cho việc bọc lồng flex-wrap trong một div ml-auto
                // (cùng lỗi/cùng cách sửa như hàng lọc video ở trên).
                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                  <span className="mr-auto shrink-0 text-[12.5px] text-muted">
                    {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} trên{' '}
                    {sorted.length} video
                  </span>
                  <button
                    onClick={() => setPage(safePage - 1)}
                    disabled={safePage === 0}
                    className="shrink-0 text-[13px] rounded-[9px] px-2.5 py-1.5 bg-surface border border-border text-[#c7c8d4] hover:border-[#3a3d6b] disabled:opacity-35"
                  >
                    ‹ Trước
                  </button>
                  {Array.from({ length: pageCount }, (_, n) => (
                    <button
                      key={n}
                      onClick={() => setPage(n)}
                      className={
                        'shrink-0 text-[13px] font-semibold rounded-[9px] w-[32px] py-1.5 border ' +
                        (n === safePage
                          ? 'accent-grad text-[#0a0b10] border-transparent'
                          : 'bg-surface border-border text-[#c7c8d4] hover:border-[#3a3d6b]')
                      }
                    >
                      {n + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setPage(safePage + 1)}
                    disabled={safePage >= pageCount - 1}
                    className="shrink-0 text-[13px] rounded-[9px] px-2.5 py-1.5 bg-surface border border-border text-[#c7c8d4] hover:border-[#3a3d6b] disabled:opacity-35"
                  >
                    Sau ›
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
