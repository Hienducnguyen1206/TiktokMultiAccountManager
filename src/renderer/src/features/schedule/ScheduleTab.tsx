import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { GroupMark } from '../../components/GroupMark'
import { NO_GROUP } from '../../components/groupStyle'
import { Select } from '../../components/Select'
import { Toggle } from '../../components/Toggle'
import { confirmDialog, confirmDialogEx } from '../../components/uiDialogs'
import type { Profile, Schedule, ScheduleRepeat, Template } from '@shared/types'

const HOUR_PX = 52
const TOP_PAD = 18 // khoảng đệm trên để 00:00 không sát mép
const EVENT_COLORS = ['#818cf8', '#22d3ee', '#fb923c', '#34d399', '#f43f5e', '#c084fc']
// Thứ hiển thị theo thứ tự T2…CN; value = getDay() (0=CN..6=T7).
const WEEKDAYS = [
  { value: 1, label: 'T2' },
  { value: 2, label: 'T3' },
  { value: 3, label: 'T4' },
  { value: 4, label: 'T5' },
  { value: 5, label: 'T6' },
  { value: 6, label: 'T7' },
  { value: 0, label: 'CN' },
]

/** Tóm tắt các thứ đã chọn cho card timeline. */
function weekdaySummary(days: number[]): string {
  if (!days || days.length === 0) return 'chưa chọn thứ'
  if (days.length === 7) return 'mỗi ngày'
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'T2–T6'
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'cuối tuần'
  return WEEKDAYS.filter((d) => days.includes(d.value))
    .map((d) => d.label)
    .join(', ')
}

function minutesOfDay(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function minutesToTime(mins: number): string {
  const m = Math.max(0, Math.min(1439, mins))
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

export function ScheduleTab(): JSX.Element {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [sel, setSel] = useState<Schedule | null>(null)
  const [dirty, setDirty] = useState(false)
  const [q, setQ] = useState('')
  const [fired, setFired] = useState<string | null>(null)
  // Khai báo ở đây (không nằm dưới khối kéo-thả) vì scrollTimeTo() bên dưới cần nó.
  const trackRef = useRef<HTMLDivElement>(null)

  const load = async (): Promise<void> => {
    const [s, t, p] = await Promise.all([
      window.hnv.schedules.list(),
      window.hnv.templates.list(),
      window.hnv.profiles.list(),
    ])
    setSchedules(s)
    setTemplates(t)
    // Chỉ hiện profile đã đăng nhập TikTok
    setProfiles(p.filter((x) => x.loggedIn))
    setSel((cur) => s.find((x) => x.id === cur?.id) ?? cur)
  }
  useEffect(() => {
    load()
    const off = window.hnv.onScheduleFired((_id, name) => {
      setFired(name)
      setTimeout(() => setFired(null), 6000)
      load()
    })
    return off
  }, [])

  const patch = (p: Partial<Schedule>): void => {
    if (!sel) return
    setSel({ ...sel, ...p })
    setDirty(true)
  }

  /** Timeline nằm trong vùng cuộn riêng cao 24 giờ. Card mới tạo được đặt theo GIỜ
   *  của nó, nên nếu người dùng đang cuộn ở khung giờ khác thì card sinh ra NGOÀI vùng
   *  nhìn và không có dấu hiệu gì là đã tạo được — đúng lỗi "tạo mà không hiện", rồi
   *  đổi tab quay lại (remount reset scrollTop về 0) thì thấy hiện ra một đống. */
  const scrollTimeTo = (time: string): void => {
    const scroller = trackRef.current?.parentElement
    if (!scroller) return
    const y = TOP_PAD + (minutesOfDay(time) / 60) * HOUR_PX
    scroller.scrollTo({
      top: Math.max(0, y - scroller.clientHeight / 2),
      behavior: 'smooth',
    })
  }

  /** Rời schedule đang mở khi còn thay đổi chưa lưu. Trước đây mọi nơi gọi setSel()
   *  thẳng nên thay đổi bị bỏ ÂM THẦM, không hỏi, không cách nào lấy lại.
   *
   *  Ba đường: hủy (ở lại), bỏ thay đổi, hoặc lưu rồi đi tiếp — đỡ phải đóng hộp
   *  thoại, bấm Lưu, rồi làm lại thao tác vừa bị chặn. */
  const confirmLeaveDirty = async (): Promise<boolean> => {
    if (!dirty) return true
    const r = await confirmDialogEx({
      title: 'Bỏ thay đổi chưa lưu?',
      message: `"${sel?.name}" đang có thay đổi chưa lưu. Rời khỏi nó sẽ mất các thay đổi này.`,
      confirmText: 'Bỏ thay đổi',
      altText: 'Lưu',
    })
    if (r === 'alt') {
      await save()
      return true
    }
    return r === 'confirm'
  }

  const createNew = async (): Promise<void> => {
    if (!(await confirmLeaveDirty())) return
    const s = await window.hnv.schedules.create()
    await load()
    setSel(s)
    setDirty(false)
    scrollTimeTo(s.time)
  }
  const save = async (): Promise<void> => {
    if (!sel) return
    await window.hnv.schedules.save(sel)
    setDirty(false)
    await load()
  }
  const del = async (): Promise<void> => {
    if (!sel) return
    if (
      !(await confirmDialog({
        title: 'Xóa schedule',
        message: `Xóa schedule "${sel.name}"?`,
        confirmText: 'Xóa',
      }))
    )
      return
    await window.hnv.schedules.remove(sel.id)
    setSel(null)
    await load()
  }

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragInfo = useRef<{ moved: boolean; time: string } | null>(null)

  /** Chọn một schedule — chuột TRÁI. Hỏi trước nếu đang có thay đổi chưa lưu. */
  const selectSchedule = async (s: Schedule): Promise<void> => {
    if (s.id === sel?.id) return
    if (!(await confirmLeaveDirty())) return
    setSel(s)
    setDirty(false)
  }

  /**
   * Kéo card để chỉnh giờ — chỉ khi GIỮ CHUỘT PHẢI.
   *
   * Trước đây chuột trái vừa chọn vừa kéo, nên chỉ cần nhích tay vài pixel lúc bấm
   * chọn là giờ chạy đã đổi và được lưu ngay. Tách hẳn hai việc: trái = chọn,
   * phải = di chuyển.
   */
  const startDrag = (e: React.PointerEvent, s: Schedule): void => {
    e.preventDefault()
    dragInfo.current = { moved: false, time: s.time }
    const move = (ev: PointerEvent): void => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return
      let mins = Math.round(((ev.clientY - rect.top - TOP_PAD) / HOUR_PX) * 60)
      mins = Math.max(0, Math.min(1439, mins))
      const time = minutesToTime(mins)
      dragInfo.current = { moved: true, time }
      setDraggingId(s.id)
      setSchedules((prev) => prev.map((x) => (x.id === s.id ? { ...x, time } : x)))
      setSel((cur) => (cur && cur.id === s.id ? { ...cur, time } : cur))
    }
    const up = async (): Promise<void> => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const info = dragInfo.current
      setDraggingId(null)
      dragInfo.current = null
      // Giữ chuột phải rồi thả tại chỗ = không đổi gì, khỏi ghi DB.
      if (info?.moved) {
        await window.hnv.schedules.save({ ...s, time: info.time })
        await load()
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? profiles.filter((p) => p.name.toLowerCase().includes(t)) : profiles
  }, [profiles, q])

  /** Danh sách chọn gom theo nhóm, "Không nhóm" xuống cuối — cùng cách sắp xếp
   *  với cây thư mục ở tab Profile, để hai nơi đọc như nhau. */
  const groupSections = useMemo(() => {
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
  }, [filtered])

  const toggleProfile = (id: string): void => {
    if (!sel) return
    const has = sel.profileIds.includes(id)
    patch({
      profileIds: has ? sel.profileIds.filter((x) => x !== id) : [...sel.profileIds, id],
    })
  }

  /** Tích ô của cả nhóm: đang chọn hết thì bỏ hết, còn lại thì chọn hết. Chỉ đụng
   *  tới những profile ĐANG HIỆN — đang lọc bằng ô tìm kiếm thì không âm thầm
   *  gán thêm những cái không nhìn thấy. */
  const toggleGroupProfiles = (items: Profile[]): void => {
    if (!sel) return
    const ids = items.map((p) => p.id)
    const allOn = ids.every((id) => sel.profileIds.includes(id))
    patch({
      profileIds: allOn ? sel.profileIds.filter((x) => !ids.includes(x)) : [...new Set([...sel.profileIds, ...ids])],
    })
  }
  const checkAll = (): void => patch({ profileIds: profiles.map((p) => p.id) })
  const uncheckAll = (): void => patch({ profileIds: [] })

  /** Schedule đang mở có template CÓ THẬT không (id còn khớp một template đang tồn
   *  tại) — không phải chỉ "templateId khác null". */
  const hasTemplate = !!sel?.templateId && templates.some((t) => t.id === sel.templateId)

  const toggleWeekday = (d: number): void => {
    if (!sel) return
    const cur = sel.weekdays ?? []
    patch({
      weekdays: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d],
    })
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Tiêu đề tab nằm trên cùng, trải hết bề ngang — giống mọi tab khác */}
      <div className="px-[22px] pt-[18px] pb-3.5 text-[21px] font-bold text-grad shrink-0 flex items-center gap-2">
        <Icon name="schedule" filled size={24} className="icon-grad" />
        Lịch chạy
      </div>

      {/* min-h-0: flex-1 mặc định min-height:auto nên hàng này phình theo nội dung,
          làm overflow-auto bên trong không bao giờ có chiều cao giới hạn → mất cuộn. */}
      <div className="flex-1 flex min-w-0 min-h-0">
        {/* timeline */}
        <div className="w-[380px] shrink-0 border-r border-borderSoft flex flex-col">
          <div className="px-[18px] pt-1 pb-3 flex items-center">
            <div className="text-[12px] uppercase tracking-wider text-muted font-semibold">Lịch chạy</div>
            <button
              onClick={createNew}
              className="ml-auto accent-grad text-[#0a0b10] font-bold rounded-lg px-3 py-1.5 text-[13px]"
            >
              + Schedule
            </button>
          </div>
          {fired && (
            <div className="mx-3 mb-2 text-[12px] text-ok bg-[#10231b] border border-[#2c5443] rounded-lg px-3 py-2">
              ▶ Đã kích hoạt: <b>{fired}</b>
            </div>
          )}
          <div className="flex-1 overflow-auto hv-scroll px-3 pb-3">
            {/* Chặn menu ngữ cảnh trên cả trục, không chỉ trên card: khi kéo bằng
              chuột phải, con trỏ thường đã rời khỏi card lúc thả tay. */}
            <div
              ref={trackRef}
              onContextMenu={(e) => e.preventDefault()}
              className="relative"
              style={{ height: 24 * HOUR_PX + TOP_PAD * 2 }}
            >
              <div className="absolute left-[52px] w-px bg-[#16171f]" style={{ top: TOP_PAD, bottom: TOP_PAD }} />
              {Array.from({ length: 13 }).map((_, i) => {
                const hh = i * 2
                const y = TOP_PAD + hh * HOUR_PX
                return (
                  <div key={i}>
                    <div className="absolute left-0 w-[44px] text-right text-[11px] text-muted" style={{ top: y - 7 }}>
                      {pad2(hh)}:00
                    </div>
                    <div className="absolute left-[52px] right-1 h-px bg-[#16171f]" style={{ top: y }} />
                  </div>
                )
              })}
              {schedules.map((s, i) => {
                const top = TOP_PAD + (minutesOfDay(s.time) / 60) * HOUR_PX
                const color = EVENT_COLORS[i % EVENT_COLORS.length]
                const on = s.id === sel?.id
                const dragging = s.id === draggingId
                const tpl = templates.find((t) => t.id === s.templateId)
                // Đủ điều kiện & sẽ chạy = bật + có template + có ≥1 profile.
                // Sáng nếu đủ điều kiện; mờ nếu không — trừ khi đang được chọn/kéo.
                const eligible = s.enabled && !!s.templateId && s.profileIds.length > 0
                const border = dragging || on ? 'border-accent2' : 'border-[#3a3c4a]'
                const ring = dragging ? 'shadow-[0_0_0_2px_#22d3ee]' : on ? 'shadow-[0_0_0_1px_#22d3ee]' : ''
                return (
                  <div key={s.id}>
                    <div
                      className="absolute w-[11px] h-[11px] rounded-full border-2 border-bg z-10"
                      style={{ left: 47, top: top - 1, background: color }}
                    />
                    <div
                      onPointerDown={(e) => {
                        // Trái = chọn, phải = kéo đổi giờ. Nút giữa và các nút khác
                        // không làm gì.
                        if (e.button === 0) void selectSchedule(s)
                        else if (e.button === 2) startDrag(e, s)
                      }}
                      // Không có dòng này thì mỗi lần kéo xong menu ngữ cảnh bung ra
                      // ngay chỗ vừa thả.
                      onContextMenu={(e) => e.preventDefault()}
                      title={on ? 'Giữ chuột phải để kéo đổi giờ' : `${s.time} · ${s.name}`}
                      className={`absolute left-[62px] right-2 rounded-[11px] select-none bg-[#20232f] shadow-[0_2px_8px_rgba(0,0,0,.4)] border ${border} ${ring} ${
                        on ? 'p-2.5' : 'px-2.5 py-1.5'
                      } ${dragging ? 'cursor-grabbing z-30' : on ? 'cursor-grab z-20' : 'cursor-pointer z-0'}`}
                      // Card thu gọn thấp hơn nên mốc neo cũng phải khác, nếu không nó
                      // lệch so với chấm tròn đánh dấu giờ bên trái.
                      style={{
                        top: top - (on ? 16 : 13),
                        // Card thu gọn chỉ còn dải màu để phân biệt nên dải phải dày
                        // và rõ hơn; card mở đã có tên + nhiều thông tin khác.
                        borderLeft: `${on ? 3 : 5}px solid ${color}`,
                        opacity: on || dragging || eligible ? 1 : 0.4,
                      }}
                    >
                      {on ? (
                        <>
                          <div className="flex items-center">
                            <span className="text-muted mr-1.5 text-[12px]">⠿</span>
                            <span className="font-bold text-[14px]">{s.name}</span>
                            <span className="ml-auto text-[12px] font-bold text-[#cdd3e1] bg-bg border border-[#23252f] rounded-md px-2 py-0.5">
                              {s.time}
                            </span>
                          </div>
                          <div className="text-[11.5px] text-subtle mt-1.5">
                            {tpl ? (
                              <>
                                <Icon name="videocam" filled size={15} className="inline align-[-3px] mr-1" />
                                {tpl.name}
                              </>
                            ) : (
                              <>
                                <Icon name="warning" filled size={15} className="inline align-[-3px] mr-1" />
                                chưa chọn template
                              </>
                            )}{' '}
                            · {s.profileIds.length} profile ·{' '}
                            {s.repeat === 'weekly' ? (
                              <>
                                <Icon name="repeat" filled size={15} className="inline align-[-3px] mr-1" />
                                {weekdaySummary(s.weekdays)}
                              </>
                            ) : (
                              <>
                                <Icon name="clock" filled size={15} className="inline align-[-3px] mr-1" />
                                một lần{s.date ? ` · ${s.date}` : ''}
                              </>
                            )}
                          </div>
                        </>
                      ) : (
                        // Thu gọn: dải màu bên trái (borderLeft ở trên), tên template
                        // và giờ chạy. Tên schedule nằm ở tooltip.
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] truncate">
                            {tpl ? (
                              tpl.name
                            ) : (
                              <span className="text-warn">
                                <Icon name="warning" filled size={15} className="inline align-[-3px] mr-1" />
                                chưa chọn template
                              </span>
                            )}
                          </span>
                          <span className="ml-auto shrink-0 text-[11.5px] font-bold text-[#cdd3e1] bg-bg border border-[#23252f] rounded-md px-1.5 py-px">
                            {s.time}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* config */}
        {sel ? (
          <div className="flex-1 flex flex-col min-w-0">
            {/* Công tắc bật/tắt đặt ngay header để luôn thấy, không phải cuộn xuống.
              Trước đây UI KHÔNG có chỗ nào ghi `enabled` — chỉ đọc để làm mờ card —
              nhưng Scheduler lại dùng nó để quyết định có chạy hay không, và lịch
              "một lần" tự tắt sau khi chạy xong. Hệ quả: lịch đã chạy bị mờ vĩnh viễn
              và không có cách nào bật lại, chỉ còn nước xóa đi tạo lại. */}
            <div className="px-[22px] py-4 border-b border-borderSoft flex items-center gap-3">
              <div className="text-[18px] font-bold">Cấu hình schedule</div>
              {/* Chưa chọn template thì không bật được: Scheduler bỏ qua lịch đó và
                ScheduleStore.save() ép cờ về false, nên một công tắc bật được ở
                đây chỉ là lời hứa suông.

                Điều kiện là template CÓ THẬT trong danh sách, không phải chỉ
                `templateId` khác null — template đã xóa để lại một id mồ côi, và
                dropdown khi đó hiện "— Chưa chọn —" trong khi phép thử null vẫn
                lọt, nên công tắc mở được cho một lịch không thể chạy. */}
              <div
                className="ml-auto flex items-center gap-2.5"
                title={hasTemplate ? undefined : 'Chọn task (template) trước thì mới bật được'}
              >
                <span className={'text-[13px] ' + (sel.enabled ? 'text-ok' : 'text-muted')}>
                  {sel.enabled ? (
                    <>
                      <Icon name="play" filled size={15} className="inline align-[-3px] mr-1" />
                      Đang bật
                    </>
                  ) : hasTemplate ? (
                    <>
                      <Icon name="pause" filled size={15} className="inline align-[-3px] mr-1" />
                      Đang tắt
                    </>
                  ) : (
                    <>
                      <Icon name="pause" filled size={15} className="inline align-[-3px] mr-1" />
                      Tắt — chưa chọn template
                    </>
                  )}
                </span>
                <Toggle on={sel.enabled} disabled={!hasTemplate} onChange={(v) => patch({ enabled: v })} />
              </div>
            </div>
            <div className="flex-1 overflow-auto hv-scroll px-[22px] py-5">
              <div className="mb-4">
                <div className="text-[13px] text-subtle mb-1.5">Tên schedule</div>
                <input
                  className="inp font-semibold"
                  value={sel.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </div>
              <div className="flex gap-3 mb-4">
                <div className="w-[120px]">
                  <div className="text-[13px] text-subtle mb-1.5">Giờ chạy</div>
                  <input
                    type="time"
                    className="inp"
                    value={sel.time}
                    onChange={(e) => patch({ time: e.target.value })}
                  />
                </div>
                <div className="w-[160px]">
                  <div className="text-[13px] text-subtle mb-1.5">
                    {sel.repeat === 'once' ? 'Ngày chạy' : 'Bắt đầu từ'}
                  </div>
                  <input
                    type="date"
                    className="inp"
                    value={sel.date ?? ''}
                    onChange={(e) => patch({ date: e.target.value })}
                  />
                </div>
                <div className="flex-1">
                  <div className="text-[13px] text-subtle mb-1.5">Lặp lại</div>
                  <div className="flex gap-2">
                    {(['once', 'weekly'] as ScheduleRepeat[]).map((r) => (
                      <button
                        key={r}
                        onClick={() => patch({ repeat: r })}
                        className={
                          'rounded-lg px-4 py-2.5 text-[13px] border ' +
                          (sel.repeat === r
                            ? 'text-white font-semibold border-[#3a3d6b] bg-[linear-gradient(100deg,rgba(99,102,241,.2),rgba(34,211,238,.08))]'
                            : 'text-subtle border-border bg-[#101117]')
                        }
                      >
                        {r === 'once' ? 'Một lần' : 'Lặp lại'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {sel.repeat === 'weekly' && (
                <div className="mb-4">
                  <div className="flex items-center mb-1.5">
                    <div className="text-[13px] text-subtle">Các thứ trong tuần</div>
                    <button
                      onClick={() => patch({ weekdays: [0, 1, 2, 3, 4, 5, 6] })}
                      className="ml-auto text-[12px] text-accent2"
                    >
                      Mỗi ngày
                    </button>
                    <button
                      onClick={() => patch({ weekdays: [1, 2, 3, 4, 5] })}
                      className="ml-3 text-[12px] text-accent2"
                    >
                      T2–T6
                    </button>
                    <button onClick={() => patch({ weekdays: [0, 6] })} className="ml-3 text-[12px] text-accent2">
                      Cuối tuần
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    {WEEKDAYS.map((d) => {
                      const on = (sel.weekdays ?? []).includes(d.value)
                      return (
                        <button
                          key={d.value}
                          onClick={() => toggleWeekday(d.value)}
                          className={
                            'flex-1 rounded-lg py-2.5 text-[13px] font-semibold border ' +
                            (on
                              ? 'text-white border-[#3a3d6b] bg-[linear-gradient(100deg,rgba(99,102,241,.25),rgba(34,211,238,.12))]'
                              : 'text-subtle border-border bg-[#101117]')
                          }
                        >
                          {d.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="mb-4">
                <div className="text-[13px] text-subtle mb-1.5">Task (template)</div>
                <Select
                  value={sel.templateId ?? ''}
                  // Bỏ template thì tắt luôn ngay trong state, không đợi tới lúc lưu
                  // mới thấy — nếu không, nhãn vẫn ghi "Đang bật" cho tới khi bấm Lưu.
                  onChange={(v) => patch(v ? { templateId: v } : { templateId: null, enabled: false })}
                  options={[
                    { value: '', label: '— Chọn template —' },
                    ...templates.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                />
              </div>

              <div className="flex items-center mb-2">
                <div className="text-[13px] text-subtle">
                  Hồ sơ sẽ chạy <span className="text-ok">· đã chọn {sel.profileIds.length}</span>
                </div>
              </div>
              <div className="bg-card border border-borderSoft rounded-[11px] p-3">
                <div className="flex gap-2.5 mb-2.5">
                  <button
                    onClick={checkAll}
                    className="flex-1 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-accent2 border border-[#3a3d6b] bg-[linear-gradient(100deg,rgba(99,102,241,.18),rgba(34,211,238,.10))]"
                  >
                    Chọn tất cả
                  </button>
                  <button
                    onClick={uncheckAll}
                    className="flex-1 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-warn border border-[#6b4422] bg-[rgba(251,146,60,.12)]"
                  >
                    Bỏ chọn tất cả
                  </button>
                </div>
                <div className="relative mb-2">
                  <Icon
                    name="search"
                    size={17}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                  />
                  <input
                    className="inp pl-9"
                    placeholder="Tìm hồ sơ..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                {/* Cuộn thay cho phân trang: gom theo nhóm mà còn chia trang thì một
                  nhóm bị cắt làm đôi giữa hai trang, và tích cả nhóm sẽ chỉ tích
                  được nửa đang hiện. */}
                <div className="text-[13px] max-h-[320px] overflow-auto hv-scroll">
                  {groupSections.map((sec) => {
                    const ids = sec.items.map((p) => p.id)
                    const onCount = ids.filter((id) => sel.profileIds.includes(id)).length
                    const all = onCount === ids.length && ids.length > 0
                    const some = onCount > 0 && !all
                    return (
                      <div key={sec.key} className="mb-1">
                        <div
                          onClick={() => toggleGroupProfiles(sec.items)}
                          className="flex items-center py-2 px-2 rounded-lg cursor-pointer bg-[#12131b] hover:bg-[#161822]"
                        >
                          <span
                            className={
                              'w-[18px] h-[18px] rounded-[5px] inline-flex items-center justify-center text-[12px] font-black ' +
                              (all
                                ? 'accent-grad text-[#0a0b10]'
                                : some
                                  ? 'accent-grad text-[#0a0b10]'
                                  : 'border-[1.5px] border-[#3b3d4f]')
                            }
                          >
                            {all ? (
                              <Icon name="check" filled size={14} className="inline align-[-3px]" />
                            ) : some ? (
                              '–'
                            ) : (
                              ''
                            )}
                          </span>
                          <span className="ml-2.5 flex items-center gap-1.5 font-semibold">
                            <GroupMark icon={sec.head?.groupIcon} color={sec.head?.groupColor} />
                            <span className={sec.head ? '' : 'text-subtle'}>{sec.head?.groupName ?? 'Không nhóm'}</span>
                          </span>
                          <span className="ml-auto text-[12px] text-muted">
                            {onCount}/{ids.length}
                          </span>
                        </div>
                        {sec.items.map((p) => {
                          const on = sel.profileIds.includes(p.id)
                          return (
                            <div
                              key={p.id}
                              onClick={() => toggleProfile(p.id)}
                              className="flex items-center py-2 pl-6 pr-2 rounded-lg hover:bg-[#101117] cursor-pointer"
                            >
                              <span
                                className={
                                  'w-[18px] h-[18px] rounded-[5px] inline-flex items-center justify-center text-[12px] font-black ' +
                                  (on ? 'accent-grad text-[#0a0b10]' : 'border-[1.5px] border-[#3b3d4f]')
                                }
                              >
                                {on ? <Icon name="check" filled size={14} className="inline align-[-3px]" /> : ''}
                              </span>
                              <span className={'ml-2.5 ' + (on ? '' : 'text-subtle')}>{p.name}</span>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                  {filtered.length === 0 && <div className="text-muted py-2 px-2">Không có hồ sơ.</div>}
                </div>
              </div>
            </div>

            <div className="px-[22px] py-3.5 border-t border-borderSoft flex gap-2.5 items-center">
              <button
                onClick={del}
                className="text-danger border border-[#5a2c33] bg-[rgba(251,113,133,.10)] rounded-[9px] px-[22px] py-2.5 text-[14px] font-semibold"
              >
                <Icon name="trash" filled size={16} className="inline align-[-3px] mr-1" />
                Xóa schedule
              </button>
              <button
                onClick={save}
                disabled={!dirty}
                className="ml-auto accent-grad text-[#0a0b10] font-bold rounded-[9px] px-[22px] py-2.5 text-[14px] disabled:opacity-40"
              >
                {dirty ? 'Lưu' : 'Đã lưu'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted">
            <div className="text-center">
              <div className="text-xl font-bold mb-2">Chưa chọn schedule</div>
              <div>
                Bấm <b className="text-accent2">+ Schedule</b> hoặc chọn một điểm trên timeline.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
