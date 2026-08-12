import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from '../../components/Avatar'
import { GroupMark } from '../../components/GroupMark'
import { Icon, type IconName } from '../../components/Icon'
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
  VideoPrivacy,
} from '@shared/types'

const PRIVACY_LABEL: Record<VideoPrivacy, string> = {
  public: 'Mọi người',
  friends: 'Bạn bè',
  private: 'Chỉ mình tôi',
}

/** Quyền riêng tư giờ nằm trong cột Thao tác nên không còn chữ đi kèm — biểu
 *  tượng phải tự nói lên giá trị, mỗi mức một hình khác hẳn nhau. */
const PRIVACY_ICON: Record<VideoPrivacy, IconName> = {
  public: 'globe',
  friends: 'profile',
  private: 'lock',
}

/** Đúng hai lựa chọn TikTok web đưa ra — bản điện thoại còn "Không ai", web không có. */
const AUDIENCE_OPTIONS = [
  { value: 'everyone', label: 'Mọi người' },
  { value: 'friends', label: 'Bạn bè' },
]

const PRIVACY_FIELDS = ['privateAccount', 'comment', 'duet'] as const

// Khoá `duet` giữ nguyên tên của TikTok để khớp chỗ đọc/ghi; chỉ chữ hiện ra là
// theo cách gọi của mình.
const PRIVACY_FIELD_LABEL: Record<keyof AccountPrivacyPatch, string> = {
  privateAccount: 'Tài khoản riêng tư',
  comment: 'Quyền bình luận',
  duet: 'Quyền đăng lại',
}

const NO_PRIVACY: AccountPrivacy = {
  privateAccount: null,
  comment: null,
  duet: null,
}

/**
 * Nguyên văn điều TikTok nói trong hộp xác nhận xóa của chính nó.
 *
 * Trước đây app ghi "KHÔNG thể khôi phục" — sai. Dò ra mới biết còn 30 ngày để
 * lấy lại, và người dùng cần biết đúng mức độ nghiêm trọng, không hơn không kém.
 */
const RESTORE_NOTE = 'TikTok cho khôi phục trong 30 ngày qua Trung tâm hoạt động > Đã xóa gần đây. Sau đó mới mất hẳn.'

/**
 * Đổi @username nặng hơn hẳn đổi tên hiển thị, nên phải nói trước khi bấm Lưu.
 *
 * TikTok chỉ cho đổi 30 ngày một lần và tính mốc đó ở máy chủ — gõ nhầm là chờ
 * hết tháng, không có cách lách. Kèm theo đó mọi liên kết cũ tới tài khoản đều
 * hỏng, và tên cũ bị thả ra cho người khác lấy.
 */
const USERNAME_NOTE =
  '@username chỉ đổi được 30 ngày một lần. Mọi liên kết cũ tới tài khoản sẽ hỏng, và tên cũ có thể bị người khác lấy mất.'

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
  { value: 'asc', label: '↑ Lượt xem tăng dần' },
]

/** Giới hạn ký tự của TikTok. Chặn ngay ở ô nhập thay vì để TikTok từ chối sau
 *  khi đã mở trình duyệt — lỗi biết trước thì báo trước, khỏi tốn 10 giây. */
const MAX_NAME = 30
const MAX_USERNAME = 24

/** Nút vuông trên thanh tiêu đề tài khoản. Ghim 40px để cụm nút không xê dịch khi
 *  trạng thái đổi — đó chính là thứ nhãn co giãn từng gây ra. */
const HEAD_BTN =
  'w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-[10px] font-bold transition disabled:opacity-40'

/** Ba nút sửa hồ sơ dưới avatar. Nhỏ hơn HEAD_BTN (36 thay vì 40) để hàng ba nút
 *  không rộng quá so với avatar 54px bên trên. */
const SUB_BTN =
  'w-9 h-9 inline-flex items-center justify-center rounded-[9px] border font-bold transition disabled:opacity-40'

/** Dùng cho menu lọc quyền riêng tư trên thanh công cụ video. */
const PRIVACY_FILTER_OPTIONS = [
  { value: 'all', label: 'Tất cả quyền riêng tư' },
  { value: 'public', label: PRIVACY_LABEL.public },
  { value: 'friends', label: PRIVACY_LABEL.friends },
  { value: 'private', label: PRIVACY_LABEL.private },
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
    // Bề rộng do grid-cols-4 ở ngoài chia đều, KHÔNG bám theo nội dung — nên khi
    // dữ liệu về, "—" thành "1,234,567" mà hàng thẻ vẫn đứng yên.
    <div className="bg-card border border-borderSoft rounded-[12px] px-4 py-3">
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
  // Hai menu thả xuống trên thanh công cụ video (sắp xếp / quyền riêng tư).
  const [sortOpen, setSortOpen] = useState(false)
  const [privOpen, setPrivOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  /** Đổi @username. Tách khỏi tên hiển thị vì đây là thứ nặng hơn hẳn: TikTok
   *  chỉ cho đổi 30 ngày một lần, và mọi liên kết cũ tới tài khoản sẽ chết. */
  const [editingUser, setEditingUser] = useState(false)
  const [userDraft, setUserDraft] = useState('')
  // Thay đổi video CHƯA gửi đi, giữ riêng theo profile. Sửa thoải mái rồi mới
  // bấm Lưu một lần — mỗi lần mở profile tốn khoảng 10 giây khởi động Chromium,
  // áp dụng ngay từng thao tác thì sửa năm thứ là chờ năm lần.
  const [edits, setEdits] = useState<Record<string, VideoEdits>>({})
  /** Toạ độ menu chuột phải trên bảng video. null = đang đóng. */
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  /** Menu quyền riêng tư của MỘT video, mở từ nút trong cột Thao tác. Dùng toạ độ
   *  màn hình + portal như menu chuột phải chứ không absolute trong ô: khung bảng
   *  có overflow-hidden nên menu mở ở hàng cuối sẽ bị cắt cụt. */
  const [privMenu, setPrivMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  /** Hàng bấm gần nhất — mốc để Shift chọn cả khoảng. */
  const [anchor, setAnchor] = useState<string | null>(null)
  /** Ảnh đại diện đã chọn nhưng CHƯA tải lên — chờ nút Lưu như mọi thay đổi khác. */
  const [avatarPick, setAvatarPick] = useState<{
    path: string
    dataUrl: string
  } | null>(null)
  /** Ảnh đã lưu thành công trong phiên này. Giữ lại để khung avatar không quay
   *  về ảnh cũ ngay sau khi lưu — bản ghi profile chỉ cập nhật ở lần đồng bộ sau. */
  const [avatarSaved, setAvatarSaved] = useState<string | null>(null)
  /** @username vừa đổi thành công trong phiên này. Cần giữ riêng vì danh sách
   *  profile truyền vào tab chỉ làm mới ở lần đồng bộ sau — không có nó thì lưu
   *  xong app vẫn tưởng username còn là tên cũ và đếm mãi một thay đổi đang chờ. */
  const [userSaved, setUserSaved] = useState<string | null>(null)

  useEffect(() => window.hnv.onManagerProgress((_id, msg) => setProgress(msg)), [])

  // Hai menu nổi (chuột phải + quyền riêng tư từng video) đóng khi bấm ra ngoài,
  // nhấn Escape, hoặc cuộn — chúng neo theo toạ độ màn hình nên cuộn là lệch chỗ.
  useEffect(() => {
    if (!ctx && !privMenu) return
    const close = (): void => {
      setCtx(null)
      setPrivMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
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
  }, [ctx, privMenu])

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
      ...named.map(([key, items]) => ({
        key,
        items,
        head: items[0] as Profile | null,
      })),
      ...(loose ? [{ key: NO_GROUP, items: loose, head: null }] : []),
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
    setEditingUser(false)
    setUserDraft('')
    setUserSaved(null)
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

  /** Quyền riêng tư đang hiện của video mở menu — để đánh dấu ✓ đúng dòng. Menu
   *  nằm ngoài vòng lặp bảng nên chỉ có id, phải tra ngược lại video. */
  const privMenuValue = privMenu
    ? (myEdits.privacy[privMenu.id] ?? acc?.videos.find((v) => v.id === privMenu.id)?.privacy)
    : undefined

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
      remove: e.remove.includes(id) ? e.remove.filter((x) => x !== id) : [...e.remove, id],
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

  /** Bỏ MỌI thay đổi chưa lưu của tab: video, quyền riêng tư, tên, @username. */
  const resetAll = (): void => {
    if (!selId) return
    setEdits((prev) => ({ ...prev, [selId]: NO_EDITS }))
    setDrafts((prev) => ({ ...prev, [selId]: {} }))
    setNameDraft(acc?.displayName ?? '')
    setUserDraft('')
    setAvatarPick(null)
    setRenaming(false)
    setEditingUser(false)
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
      userDirty ? `• Đổi @username: @${userNow} → @${userClean}` : '',
      avatarPick ? `• Đổi ảnh đại diện: ${fileName(avatarPick.path)}` : '',
      ...dirty.map((k) => {
        const v = draft[k]
        const shown = typeof v === 'boolean' ? (v ? 'Bật' : 'Tắt') : v === 'friends' ? 'Bạn bè' : 'Mọi người'
        return `• ${PRIVACY_FIELD_LABEL[k]}: ${shown}`
      }),
      nChange ? `• Đổi quyền riêng tư: ${nChange} video` : '',
      nRemove ? `• Xóa: ${nRemove} video` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const ok = await confirmDialog({
      title: 'Lưu thay đổi lên TikTok',
      message:
        `Tài khoản "${sel.name}":\n${lines}\n\n` +
        (nRemove ? `${RESTORE_NOTE}\n\n` : '') +
        (userDirty ? `${USERNAME_NOTE}\n\n` : '') +
        'Sẽ mở trình duyệt của hồ sơ này để thao tác.',
      confirmText: `Lưu ${totalPending} thay đổi`,
      // Đây là ghi thêm chứ không phải xóa — để mặc định danger thì nút chính đỏ,
      // trông ngang với hộp xác nhận xóa profile. false cho nó xanh lá như nút Lưu.
      danger: false,
    })
    if (!ok) return

    const accPatch: AccountPrivacyPatch = {}
    for (const k of dirty) Object.assign(accPatch, { [k]: draft[k] })

    setLoading(true)
    setProgress('Đang chuẩn bị…')
    try {
      const r = await window.hnv.manager.applyAll(sel.id, {
        displayName: nameDirty ? nameDraft.trim() : undefined,
        username: userDirty ? userClean : undefined,
        avatarPath: avatarPick?.path,
        privacy: dirty.length ? accPatch : undefined,
        videos: pendingCount ? { privacy: myEdits.privacy, remove: myEdits.remove } : undefined,
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
              .map((v) => (done.has(v.id) ? { ...v, privacy: myEdits.privacy[v.id] } : v)),
          },
        }
      })
      setEdits((prev) => {
        const cur = prev[sel.id] ?? NO_EDITS
        const p = { ...cur.privacy }
        for (const id of done) delete p[id]
        return {
          ...prev,
          [sel.id]: {
            privacy: p,
            remove: cur.remove.filter((id) => !gone.has(id)),
          },
        }
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
      if (r.username) {
        setEditingUser(false)
        setUserSaved(r.username)
        setUserDraft(r.username)
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
    duet: draft.duet ?? accPriv.duet,
  }
  const dirty = acc ? PRIVACY_FIELDS.filter((k) => draft[k] !== undefined && draft[k] !== accPriv[k]) : []

  /** Tên hiển thị đã sửa nhưng chưa lưu. */
  const nameDirty = !!acc && nameDraft.trim() !== '' && nameDraft.trim() !== (acc.displayName ?? '')
  /** @username đã sửa nhưng chưa lưu. So không phân biệt hoa thường vì TikTok
   *  luôn hạ về chữ thường — gõ "Abc" khi đang là "abc" thì không phải thay đổi. */
  const userClean = userDraft.trim().replace(/^@/, '').toLowerCase()
  /** Username đang thật sự dùng: bản vừa lưu trong phiên này nếu có. */
  const userNow = (userSaved ?? sel?.tiktokUsername ?? '').toLowerCase()
  const userDirty = !!sel && userClean !== '' && userClean !== userNow
  /** Tổng số thứ đang chờ lưu của CẢ tab — nút Lưu/Hoàn tác đếm theo con số này. */
  const totalPending = pendingCount + dirty.length + (nameDirty ? 1 : 0) + (userDirty ? 1 : 0) + (avatarPick ? 1 : 0)

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
  const CtxItem = ({ label, onPick, danger }: { label: string; onPick: () => void; danger?: boolean }): JSX.Element => (
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
      <div className="px-[22px] pt-[18px] pb-3.5 text-[21px] font-bold text-grad shrink-0 flex items-center gap-2">
        <Icon name="manager" filled size={24} className="icon-grad" />
        Quản lý hồ sơ
      </div>

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
              top: Math.min(ctx.y, window.innerHeight - 250),
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
            <CtxItem label="Đánh dấu xóa" onPick={bulkDelete} danger />
            <div className="my-1 h-px bg-[#23242e]" />
            <CtxItem
              label={`Chọn cả ${sorted.length} video đang lọc`}
              onPick={() => setPicked(new Set(sorted.map((v) => v.id)))}
            />
            <CtxItem label="Bỏ chọn" onPick={() => setPicked(new Set())} />
          </div>,
          document.body,
        )}

      {/* Menu quyền riêng tư của một video. Cũng qua portal, cùng lý do với menu
          chuột phải ở trên. Mở lên trên nút (y đã trừ sẵn chiều cao) để hàng cuối
          bảng không đẩy menu ra ngoài cửa sổ. */}
      {privMenu &&
        createPortal(
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              left: Math.min(privMenu.x, window.innerWidth - 196),
              top: Math.min(privMenu.y, window.innerHeight - 158),
            }}
            className="fixed z-[90] w-[184px] p-1.5 rounded-[10px] bg-[#14151c] border border-[#2e3040] shadow-[0_18px_44px_-12px_rgba(0,0,0,.8)]"
          >
            <div className="px-2.5 py-1 text-[11px] uppercase tracking-wide text-subtle">Quyền riêng tư</div>
            {(['public', 'friends', 'private'] as const).map((p) => {
              const cur = privMenuValue === p
              return (
                <button
                  key={p}
                  onClick={() => {
                    stagePrivacy([privMenu.id], p)
                    setPrivMenu(null)
                  }}
                  className={
                    'w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-[7px] text-[13.5px] ' +
                    (cur ? 'text-white bg-[rgba(99,102,241,.16)]' : 'text-[#c7c8d4] hover:bg-surface')
                  }
                >
                  <Icon name={PRIVACY_ICON[p]} filled size={15} className="shrink-0" />
                  {PRIVACY_LABEL[p]}
                  <Icon name="check" size={15} className={'ml-auto shrink-0 ' + (cur ? 'text-accent2' : 'opacity-0')} />
                </button>
              )
            })}
          </div>,
          document.body,
        )}

      <div className="flex-1 flex min-w-0 min-h-0">
        {/* ── Cột trái: chọn tài khoản ─────────────────────────────────── */}
        <div className="w-[260px] shrink-0 border-r border-borderSoft flex flex-col min-h-0">
          <div className="px-3 pb-2.5">
            <div className="relative">
              <Icon
                name="search"
                size={17}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm hồ sơ…"
                className="w-full bg-[#101117] border border-border rounded-[10px] pl-9 pr-3 py-2 text-[13.5px] outline-none focus:border-[#3a3d6b]"
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto hv-scroll px-2 pb-3">
            {totalListed === 0 ? (
              <div className="text-muted text-[13px] text-center mt-6">Không có hồ sơ nào.</div>
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
                      <span className={'min-w-0 text-[12px] font-semibold truncate ' + (sec.head ? '' : 'text-subtle')}>
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
                              <span className={'block text-[11px] truncate ' + (p.loggedIn ? 'text-ok' : 'text-muted')}>
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
              <div>Chọn một hồ sơ ở cột bên trái để xem thông tin sâu.</div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <div className="px-[22px] py-4 border-b border-borderSoft flex items-center gap-3.5">
              {/* Cột trái: avatar trên, ba nút sửa hồ sơ ngay dưới. Chúng tác động
                  lên chính khối này nên gom lại một chỗ; cụm bên phải là lệnh của
                  cả tab. Bề rộng cột do hàng nút quyết định (3×36 + 2×6 = 120px)
                  nên avatar căn giữa theo nó. */}
              <div className="shrink-0 flex flex-col items-center gap-2">
                {/* Ưu tiên ảnh đang chờ lưu → ảnh vừa lưu trong phiên → ảnh cũ.
                    Bấm Hoàn tác xoá ảnh đang chờ nên khung tự trở về ảnh cũ. */}
                <span className="relative">
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
                {/* Cả ba nút đều khoá khi CHƯA tải thông tin (acc == null): chúng
                    sửa dữ liệu mà app chưa hề đọc. Nút đổi tên sẽ điền sẵn một ô
                    rỗng rồi coi mọi thứ gõ vào là "đổi tên", ghi đè tên thật lên
                    TikTok mà không ai kịp thấy tên cũ là gì. */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setNameDraft(acc?.displayName ?? '')
                      setRenaming(true)
                    }}
                    disabled={loading || !sel.loggedIn || renaming || !acc}
                    title={acc ? 'Đổi tên hiển thị trên TikTok' : 'Bấm Tải thông tin trước'}
                    aria-label="Đổi tên hiển thị"
                    className={SUB_BTN + ' bg-surface border-border text-[#c7c8d4] hover:border-[#3a3d6b]'}
                  >
                    <Icon name="edit" filled size={17} />
                  </button>
                  {/* Đổi @username: để riêng một nút chứ không gộp vào nút đổi tên,
                      vì hai thứ khác hẳn nhau về hậu quả — tên hiển thị đổi thoải
                      mái 7 ngày một lần, còn username là 30 ngày và làm chết mọi
                      liên kết cũ. Gộp chung dễ bấm nhầm. */}
                  <button
                    onClick={() => {
                      setUserDraft(userNow)
                      setEditingUser(true)
                    }}
                    disabled={loading || !sel.loggedIn || editingUser || !acc}
                    title={acc ? 'Đổi @username trên TikTok (30 ngày một lần)' : 'Bấm Tải thông tin trước'}
                    aria-label="Đổi @username"
                    className={
                      SUB_BTN +
                      ' text-[15px] ' +
                      (userDirty
                        ? 'bg-[rgba(52,211,153,.14)] border-[#1d5a41] text-ok'
                        : 'bg-surface border-border text-[#c7c8d4] hover:border-[#3a3d6b]')
                    }
                  >
                    @
                  </button>
                  {/* Chọn ảnh xong KHÔNG tải lên ngay — nằm chờ cùng mọi thay đổi
                      khác cho tới khi bấm Lưu, như tên hiển thị và quyền riêng tư. */}
                  <button
                    onClick={async () => {
                      const p = await window.hnv.manager.pickAvatar()
                      if (p) setAvatarPick(p)
                    }}
                    disabled={loading || !sel.loggedIn || !acc}
                    title={
                      !acc
                        ? 'Bấm Tải thông tin trước'
                        : avatarPick
                          ? `Đang chờ lưu: ${fileName(avatarPick.path)} — bấm để chọn ảnh khác`
                          : 'Chọn ảnh đại diện mới (tải lên khi bấm Lưu)'
                    }
                    aria-label="Đổi ảnh đại diện"
                    className={
                      SUB_BTN +
                      ' ' +
                      (avatarPick
                        ? 'bg-[rgba(52,211,153,.14)] border-[#1d5a41] text-ok'
                        : 'bg-surface border-border text-[#c7c8d4] hover:border-[#3a3d6b]')
                    }
                  >
                    <Icon name="image" filled size={17} />
                  </button>
                </div>
              </div>
              <div className="min-w-0">
                {/* Sửa tại chỗ: app chưa có hộp nhập chữ dùng chung, mà dựng thêm
                    một cái cho đúng một ô thì thừa.

                    Ô nhập ĐÈ LÊN dòng chữ (absolute inset-0) chứ không thay chỗ
                    nó: dòng chữ vẫn dựng, chỉ tàng hình, nên nó giữ nguyên bề
                    rộng của khối. Cách cũ tháo chữ ra rồi cắm vào một ô 220px kèm
                    hai nút ✓✕ — cụm đó rộng hơn hẳn dòng chữ nên mỗi lần bấm sửa
                    là đẩy lệch cả hàng tiêu đề. min-w áp cho CẢ HAI trạng thái để
                    tên ngắn vẫn đủ chỗ gõ mà không gây nhảy khi đổi trạng thái.

                    Bỏ luôn hai nút ✓✕: Enter hoặc bấm ra ngoài là đóng và giữ
                    bản nháp, Escape trả về giá trị gốc. Không mất gì cả — tên mới
                    vẫn chỉ nằm chờ tới lúc bấm Lưu, và dòng "• chưa lưu" bên dưới
                    là thứ báo trạng thái đó. */}
                <div className="h-9 min-w-[300px] max-w-[460px] flex items-center relative">
                  {/* LÚC ĐANG SỬA thì chữ tàng hình phải giữ giá trị GỐC, không
                      bám theo nameDraft: chính nó là thứ quyết định bề rộng khối,
                      nên bám theo bản nháp thì gõ tới đâu hộp nở tới đó. max-w
                      chặn nốt trường hợp tên gốc đã dài sẵn. */}
                  <div
                    className={'flex items-center text-[18px] font-bold truncate ' + (renaming ? 'invisible' : '')}
                  >
                    {sel.name}
                    {acc?.displayName && (
                      <span className="ml-2 text-[13px] font-normal text-muted shrink-0">
                        TikTok: {nameDirty && !renaming ? nameDraft.trim() : acc.displayName}
                        {nameDirty && !renaming && <span className="ml-1 text-accent2">• chưa lưu</span>}
                      </span>
                    )}
                  </div>
                  {renaming && (
                    <input
                      autoFocus
                      value={nameDraft}
                      maxLength={MAX_NAME}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onBlur={() => setRenaming(false)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setRenaming(false)
                        if (e.key === 'Escape') {
                          setNameDraft(acc?.displayName ?? '')
                          setRenaming(false)
                        }
                      }}
                      placeholder="Tên hiển thị trên TikTok"
                      className="absolute inset-0 w-full h-9 bg-[#101117] border border-[#3a3d6b] rounded-[9px] px-2.5 text-[16px] font-bold outline-none"
                    />
                  )}
                </div>
                {/* Ô sửa @username nằm ở dòng phụ, KHÔNG thay chỗ dòng tên: đổi
                    username là việc hiếm và nặng, cần thấy rõ tên cũ ngay bên
                    trên trong lúc gõ tên mới. h-6 cho cả hai trạng thái để dòng
                    này không giãn ra làm cả bảng bên dưới nhảy xuống. */}
                <div className="h-6 min-w-[300px] max-w-[460px] flex items-center relative">
                  {/* Cùng lý do với dòng tên: userDirty tính từ userDraft, nên lúc
                      đang gõ mà vẫn hiện "@cũ → @mới" thì khối tự nở theo. */}
                  <div
                    className={
                      'flex items-center text-[12.5px] text-muted truncate ' + (editingUser ? 'invisible' : '')
                    }
                  >
                    {userDirty && !editingUser
                      ? `@${userNow} → @${userClean}`
                      : loading && progress
                        ? progress
                        : avatarPick
                          ? `Ảnh mới chờ lưu: ${fileName(avatarPick.path)}`
                          : acc?.fetchedAt
                            ? `Tải lúc ${new Date(acc.fetchedAt).toLocaleTimeString('vi-VN')} · ${acc.videos.length} video`
                            : 'Chưa tải thông tin lần nào'}
                    {userDirty && !editingUser && <span className="ml-1.5 text-accent2">• chưa lưu</span>}
                  </div>
                  {editingUser && (
                    <input
                      autoFocus
                      value={userDraft}
                      maxLength={MAX_USERNAME}
                      onChange={(e) => setUserDraft(e.target.value)}
                      onBlur={() => setEditingUser(false)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setEditingUser(false)
                        if (e.key === 'Escape') {
                          setUserDraft('')
                          setEditingUser(false)
                        }
                      }}
                      // Có "@" trong placeholder thay cho ô chữ "@" đứng riêng đã
                      // bỏ — gõ kèm @ cũng không sao, userClean cắt nó đi.
                      placeholder={`@${userNow}`}
                      spellCheck={false}
                      className="absolute inset-0 w-full h-6 bg-[#101117] border border-[#3a3d6b] rounded-md px-2 text-[12.5px] outline-none"
                    />
                  )}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2 shrink-0">
                {/* Lưu và Hoàn tác chỉ còn biểu tượng, và KHÔNG đổi ruột theo số
                    thay đổi: nhãn cũ chạy từ "Lưu" sang "Lưu 12 thay đổi" nên nút
                    co giãn mỗi lần tích thêm một dòng, kéo hai nút bên cạnh dịch
                    theo. Giờ ô vuông 40px cố định — có thay đổi thì SÁNG LÊN (bỏ
                    mờ + thêm quầng), số cụ thể để trong tooltip. */}
                <button
                  onClick={saveAll}
                  disabled={loading || totalPending === 0}
                  title={totalPending ? `Ghi ${totalPending} thay đổi lên TikTok` : 'Chưa có thay đổi nào'}
                  aria-label="Lưu thay đổi"
                  className={
                    HEAD_BTN +
                    ' ok-grad text-[#062018]' +
                    (totalPending ? ' shadow-[0_0_18px_rgba(52,211,153,.42)]' : '')
                  }
                >
                  <Icon name="save" filled size={18} />
                </button>
                <button
                  onClick={resetAll}
                  disabled={loading || totalPending === 0}
                  title={totalPending ? `Bỏ ${totalPending} thay đổi chưa lưu` : 'Chưa có thay đổi nào'}
                  aria-label="Hoàn tác thay đổi"
                  className={
                    HEAD_BTN +
                    ' warn-grad text-[#2a1608]' +
                    (totalPending ? ' shadow-[0_0_18px_rgba(251,191,36,.42)]' : '')
                  }
                >
                  <Icon name="undo" filled size={18} />
                </button>
                <button
                  onClick={load}
                  disabled={loading || !sel.loggedIn}
                  title={sel.loggedIn ? undefined : 'Hồ sơ chưa đăng nhập TikTok'}
                  className="h-10 inline-flex items-center justify-center gap-1.5 accent-grad text-[#0a0b10] font-bold text-[13px] rounded-[10px] px-4 whitespace-nowrap disabled:opacity-40"
                >
                  <Icon name={loading ? 'hourglass' : 'refresh'} filled size={16} className="mr-1.5 shrink-0" />
                  {loading ? 'Đang tải…' : 'Tải thông tin'}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto hv-scroll px-[22px] py-4">
              <div className="grid grid-cols-4 gap-2.5 mb-4">
                <Stat label="Follower" value={acc?.followers ?? null} />
                <Stat label="Đã follow" value={acc?.following ?? null} />
                <Stat label="Lượt thích" value={acc?.likes ?? null} />
                <Stat label="Video" value={acc ? acc.videos.length : null} />
              </div>

              {/* Quyền riêng tư của CẢ TÀI KHOẢN — khác cột quyền riêng tư từng
                  video ở bảng bên dưới. */}
              <div className="bg-card border border-borderSoft rounded-[14px] px-4 py-3.5 mb-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="text-[13.5px] font-semibold shrink-0 flex items-center gap-1.5">
                    <Icon name="lock" filled size={16} />
                    Quyền riêng tư tài khoản
                  </div>
                  <div className="min-w-0 text-[12px] text-muted truncate">
                    {acc ? 'Áp dụng cho cả tài khoản' : 'Chưa tải — bấm Tải thông tin để đọc'}
                  </div>
                  {/* Không có nút Lưu riêng ở đây nữa: cả tab dùng chung một nút
                      Lưu dưới thanh công cụ video. Chỉ báo còn mấy mục chưa lưu. */}
                  <span className={'ml-auto shrink-0 text-[12px] ' + (dirty.length ? 'text-accent2' : 'invisible')}>
                    {dirty.length} mục chưa lưu
                  </span>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1 flex items-center gap-3 bg-[#0e0f15] border border-borderSoft rounded-[11px] px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold">Tài khoản riêng tư</div>
                      <div className="text-[11.5px] text-muted truncate">
                        Chỉ người được duyệt mới follow và xem được
                      </div>
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
                    · {acc ? `${videos.length}${hasFilter ? ` / ${acc.videos.length}` : ''} hiển thị` : 'chưa tải'}
                  </span>
                  {/* Số đang chọn hiện ở đây thay cho thanh riêng — thanh đó cứ
                      hiện/ẩn là đẩy cả bảng lên xuống. */}
                  {picked.size > 0 && <span className="ml-1.5 text-accent2">· {picked.size} đã chọn</span>}
                </div>

                {/* Ba ô Select/input cũ chiếm gần 500px thanh công cụ chỉ để hiện
                    lại thứ đang chọn. Thu về hai nút icon mở menu, giống nút lọc
                    ở tab Hồ sơ. Chấm nhỏ trên nút báo "đang khác mặc định" nên
                    không mất thông tin: nhìn là biết có đang lọc hay không. */}
                <div className="relative shrink-0">
                  <button
                    onClick={() => setSortOpen((v) => !v)}
                    title={`Sắp xếp: ${SORT_OPTIONS.find((o) => o.value === sortDir)?.label}`}
                    aria-label="Sắp xếp"
                    className={
                      'w-10 h-10 inline-flex items-center justify-center rounded-[10px] border transition ' +
                      (sortOpen || sortDir !== 'desc' || underViews !== ''
                        ? 'border-[#3a3d6b] bg-[rgba(99,102,241,.14)] text-white'
                        : 'border-border bg-surface text-[#c7c8d4] hover:border-[#3a3d6b]')
                    }
                  >
                    <Icon name="sort" size={19} />
                    {(sortDir !== 'desc' || underViews !== '') && (
                      <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent2" />
                    )}
                  </button>
                  {sortOpen && (
                    <>
                      {/* Lớp phủ trong suốt: bấm ra ngoài là đóng, không cần nghe
                          sự kiện trên document rồi phải nhớ gỡ đi. */}
                      <div className="fixed inset-0 z-[70]" onMouseDown={() => setSortOpen(false)} />
                      {/* right-0 chứ không left-0 như tab Hồ sơ: cụm nút này nằm
                          sát mép phải, mở sang phải là menu tràn khỏi khung. */}
                      <div className="absolute z-[71] top-[46px] right-0 w-[228px] p-1.5 rounded-[10px] bg-[#14151c] border border-[#2e3040] shadow-[0_18px_44px_-12px_rgba(0,0,0,.8)]">
                        <div className="px-2.5 py-1 text-[11px] uppercase tracking-wide text-subtle">Sắp xếp theo</div>
                        {SORT_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            onClick={() => {
                              setSortDir(o.value as 'asc' | 'desc')
                              setSortOpen(false)
                            }}
                            className={
                              'w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-[7px] text-[13.5px] ' +
                              (o.value === sortDir
                                ? 'text-white bg-[rgba(99,102,241,.16)]'
                                : 'text-[#c7c8d4] hover:bg-surface')
                            }
                          >
                            <Icon
                              name="check"
                              size={15}
                              className={'shrink-0 ' + (o.value === sortDir ? 'text-accent2' : 'opacity-0')}
                            />
                            {o.label}
                          </button>
                        ))}
                        {/* Ngưỡng lượt xem nằm chung menu vì nó cũng là điều kiện
                            trên đúng cột lượt xem — để ngoài thì thanh công cụ có
                            hai thứ rời nhau cùng nói về một cột. Không đóng menu
                            khi gõ: người dùng còn phải nhìn kết quả lọc đổi theo. */}
                        <div className="mt-1 pt-1.5 border-t border-[#2e3040]">
                          <div className="px-2.5 py-1 text-[11px] uppercase tracking-wide text-subtle">
                            Lọc lượt xem
                          </div>
                          <input
                            value={underViews}
                            onChange={(e) => setUnderViews(e.target.value.replace(/\D/g, ''))}
                            placeholder="Lượt xem dưới…"
                            inputMode="numeric"
                            title="Chỉ hiện video có lượt xem nhỏ hơn số này"
                            className="w-full h-9 bg-[#101117] border border-border rounded-[8px] px-2.5 text-[13px] outline-none tabular-nums focus:border-[#3a3d6b] placeholder:text-subtle placeholder:font-normal"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="relative shrink-0">
                  <button
                    onClick={() => setPrivOpen((v) => !v)}
                    title={`Quyền riêng tư: ${PRIVACY_FILTER_OPTIONS.find((o) => o.value === privacyFilter)?.label}`}
                    aria-label="Lọc quyền riêng tư"
                    className={
                      'w-10 h-10 inline-flex items-center justify-center rounded-[10px] border transition ' +
                      (privOpen || privacyFilter !== 'all'
                        ? 'border-[#3a3d6b] bg-[rgba(99,102,241,.14)] text-white'
                        : 'border-border bg-surface text-[#c7c8d4] hover:border-[#3a3d6b]')
                    }
                  >
                    <Icon name="lock" filled size={19} />
                    {privacyFilter !== 'all' && (
                      <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent2" />
                    )}
                  </button>
                  {privOpen && (
                    <>
                      <div className="fixed inset-0 z-[70]" onMouseDown={() => setPrivOpen(false)} />
                      <div className="absolute z-[71] top-[46px] right-0 w-[212px] p-1.5 rounded-[10px] bg-[#14151c] border border-[#2e3040] shadow-[0_18px_44px_-12px_rgba(0,0,0,.8)]">
                        <div className="px-2.5 py-1 text-[11px] uppercase tracking-wide text-subtle">
                          Quyền riêng tư
                        </div>
                        {PRIVACY_FILTER_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            onClick={() => {
                              setPrivacyFilter(o.value as 'all' | VideoPrivacy)
                              setPrivOpen(false)
                            }}
                            className={
                              'w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-[7px] text-[13.5px] ' +
                              (o.value === privacyFilter
                                ? 'text-white bg-[rgba(99,102,241,.16)]'
                                : 'text-[#c7c8d4] hover:bg-surface')
                            }
                          >
                            <Icon
                              name="check"
                              size={15}
                              className={'shrink-0 ' + (o.value === privacyFilter ? 'text-accent2' : 'opacity-0')}
                            />
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div className="relative w-[180px] shrink-0">
                  <Icon
                    name="search"
                    size={17}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                  />
                  <input
                    value={videoQ}
                    onChange={(e) => setVideoQ(e.target.value)}
                    placeholder="Tìm video…"
                    className="w-full h-10 bg-[#101117] border border-border rounded-[10px] pl-9 pr-3 text-[13.5px] outline-none focus:border-[#3a3d6b]"
                  />
                </div>
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
                    <thead className="hv-th-grad text-left">
                      <tr>
                        {/* whitespace-nowrap ở mọi tiêu đề: bảng dùng table-layout
                            auto nên khi cột tên ăn hết chỗ, "Lượt xem" và "Bình
                            luận" bị bẻ làm hai dòng. Cấm xuống dòng thì trình
                            duyệt buộc phải chừa đủ bề ngang cho chúng. */}
                        <th className="px-4 py-3 font-semibold text-[12.5px] uppercase tracking-wide whitespace-nowrap">
                          Video
                        </th>
                        {/* Chỉ cột này sắp được — bấm để đảo chiều, dùng chung
                            trạng thái với ô chọn trên thanh công cụ. */}
                        <th className="px-4 py-3 font-semibold text-[12.5px] w-[104px] text-center whitespace-nowrap">
                          <button onClick={toggleSort} className="uppercase tracking-wide hover:text-white">
                            Lượt xem
                            <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>
                          </button>
                        </th>
                        <th className="px-4 py-3 font-semibold text-[12.5px] uppercase tracking-wide w-[84px] text-center whitespace-nowrap">
                          Thích
                        </th>
                        <th className="px-4 py-3 font-semibold text-[12.5px] uppercase tracking-wide w-[104px] text-center whitespace-nowrap">
                          Bình luận
                        </th>
                        <th className="px-4 py-3 font-semibold text-[12.5px] uppercase tracking-wide w-[120px] text-center whitespace-nowrap">
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
                                  <span className="text-[13px] text-subtle inline-flex items-center">
                                    <Icon name="film" filled size={15} />
                                  </span>
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
                          <td className="px-4 py-3 text-center tabular-nums">{fmt(v.views)}</td>
                          <td className="px-4 py-3 text-center tabular-nums">{fmt(v.likes)}</td>
                          <td className="px-4 py-3 text-center tabular-nums">{fmt(v.comments)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1.5">
                              {/* Quyền riêng tư chuyển từ cột riêng vào đây: cột
                                  cũ tốn 150px chỉ để hiện một giá trị đổi rất
                                  thưa. Hình biểu tượng thay cho chữ (quả cầu /
                                  người / ổ khoá), giá trị đầy đủ nằm ở tooltip và
                                  ở menu bấm ra. */}
                              <button
                                onClick={(e) => {
                                  const r = e.currentTarget.getBoundingClientRect()
                                  setPrivMenu(
                                    privMenu?.id === v.id ? null : { id: v.id, x: r.left - 74, y: r.bottom + 6 },
                                  )
                                }}
                                disabled={loading || removeSet.has(v.id)}
                                className={
                                  'w-9 h-9 inline-flex items-center justify-center rounded-lg border disabled:opacity-40 ' +
                                  // Viền sáng = giá trị này đã đổi nhưng chưa lưu.
                                  (myEdits.privacy[v.id]
                                    ? 'bg-[rgba(99,102,241,.16)] text-white border-[#6366f1]'
                                    : 'bg-surface text-[#c7c8d4] border-border hover:border-[#3a3d6b]')
                                }
                                title={`Quyền riêng tư: ${PRIVACY_LABEL[shownPrivacy(v)]}`}
                                aria-label="Đổi quyền riêng tư"
                              >
                                <Icon name={PRIVACY_ICON[shownPrivacy(v)]} filled size={16} />
                              </button>
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
                                <Icon name={removeSet.has(v.id) ? 'undo' : 'trash'} filled size={16} />
                              </button>
                            </div>
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
