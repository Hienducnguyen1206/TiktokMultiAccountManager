import { Fragment, useEffect, useMemo, useState } from 'react'
import { Avatar } from '../../components/Avatar'
import { GroupMark } from '../../components/GroupMark'
import { loadCollapsedGroups, saveCollapsedGroups, NO_GROUP } from '../../components/groupStyle'
import { Select } from '../../components/Select'
import { showToast } from '../../components/uiDialogs'
import type { AnalyticsData } from '@shared/types'

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * DỰ PHÒNG khi không đọc được cờ `monetizationActive` từ DOM: đoán qua chữ.
 *
 * Nguồn chính là thuộc tính `data-disabled` của nút trạng thái (xem
 * TikTokSync.readMonetization) — nó không bị dịch. Hàm này chỉ chạy cho những
 * bản ghi đồng bộ TRƯỚC khi có cờ đó, hoặc khi cấu trúc trang đổi làm mất nút.
 *
 * TikTok dịch nhãn theo ngôn ngữ tài khoản ("Không đủ điều kiện", "Not eligible",
 * "対象外"…) nên phải nhận theo từ khóa từng ngôn ngữ. Không nhận ra thì trả
 * `null` và bảng hiện lại nguyên văn: đoán bừa "chưa kích hoạt" cho một tài khoản
 * đang kiếm tiền là sai lệch tệ hơn là hiện chữ lạ.
 */
function guessActiveFromLabel(raw: string): boolean | null {
  const s = raw.toLowerCase()
  const inactive = ['không đủ điều kiện', 'chưa đủ điều kiện', 'not eligible', 'ineligible', '対象外', '자격 없음', '不符合条件']
  const active = ['đang hoạt động', 'đã tham gia', 'active', 'joined', 'enrolled', '参加中', '참여 중']
  if (inactive.some((k) => s.includes(k))) return false
  if (active.some((k) => s.includes(k))) return true
  return null
}

/** 'YYYY-MM-DD' theo giờ máy — cùng định dạng mà AnalyticsService ghi vào DB. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type SortKey = 'followers' | 'today' | 'd30' | 'name'

/** Số <th> trong bảng dưới (#, Ảnh, Profile, Follower, Hôm nay, 30 ngày, Số dư,
 *  Kiếm tiền). Hàng tiêu đề nhóm dùng colSpan bằng đúng con số này. */
const COL_COUNT = 8

export function AnalyticsTab(): JSX.Element {
  const [data, setData] = useState<AnalyticsData>({ dates: [], profiles: [] })
  const [collecting, setCollecting] = useState(false)
  const [progress, setProgress] = useState('')
  const [q, setQ] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('followers')
  // Dùng CHUNG trạng thái thu/mở với tab Profile — thu một nhóm ở bên kia thì
  // bên này cũng thu, vì đó là cùng một nhóm.
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsedGroups)

  const toggleGroup = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveCollapsedGroups(next)
      return next
    })

  const reload = async (): Promise<void> => setData(await window.hnv.analytics.data())
  useEffect(() => {
    reload()
    return window.hnv.onAnalyticsProgress((msg) => {
      setProgress(msg)
      // Thu thập nền (tự động khi mở app) xong → nạp lại bảng.
      if (msg.startsWith('Xong:')) reload()
    })
  }, [])

  const collect = async (): Promise<void> => {
    setCollecting(true)
    setProgress('Đang chuẩn bị…')
    try {
      const r = await window.hnv.analytics.collect()
      await reload()
      setProgress(`Xong: ${r.ok} thành công, ${r.failed} lỗi`)
    } catch (e: any) {
      showToast(e?.message ?? 'Lỗi thu thập', 'error')
    } finally {
      setCollecting(false)
    }
  }

  // bảng
  const rows = useMemo(() => {
    // Mốc 30 ngày tính một lần cho cả bảng, không tính lại trong từng hàng.
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = isoDate(cutoff)

    const arr = data.profiles.map((p) => {
      const pts = p.points
      const last = pts[pts.length - 1]
      const prev = pts[pts.length - 2]
      // Điểm cũ nhất còn nằm trong 30 ngày. points đã sắp xếp tăng dần theo ngày
      // (AnalyticsStore.data() dùng ORDER BY date ASC), nên phần tử đầu của lát
      // cắt này chính là mốc so sánh.
      const base30 = pts.find((x) => x.date >= cutoffStr)
      return {
        profileId: p.profileId,
        name: p.name,
        avatar: p.avatar,
        balance: p.balance,
        monetization: p.monetization,
        monetizationActive: p.monetizationActive,
        groupId: p.groupId,
        groupName: p.groupName ?? null,
        groupColor: p.groupColor ?? null,
        groupIcon: p.groupIcon ?? null,
        latest: last?.followers ?? 0,
        dToday: last && prev ? last.followers - prev.followers : 0,
        d30: last && base30 ? last.followers - base30.followers : 0,
        // Có số liệu nhưng TẤT CẢ đều cũ hơn 30 ngày → cột 30 ngày hiện "—".
        // Hiện 0 ở đó sẽ đọc thành "không tăng", trong khi thực tế là không có
        // gì để so trong cửa sổ 30 ngày.
        has30: !!base30,
        has: pts.length > 0
      }
    })
    const cmp: Record<SortKey, (a: typeof arr[0], b: typeof arr[0]) => number> = {
      followers: (a, b) => b.latest - a.latest,
      today: (a, b) => b.dToday - a.dToday,
      d30: (a, b) => b.d30 - a.d30,
      name: (a, b) => a.name.localeCompare(b.name, 'vi')
    }
    arr.sort(cmp[sortBy])
    const t = q.trim().toLowerCase()
    return t ? arr.filter((r) => r.name.toLowerCase().includes(t)) : arr
  }, [data, sortBy, q])

  // Gom thành cây thư mục giống tab Profile. Ở đây chỉ hiện nhóm CÓ profile —
  // khác tab Profile, nơi nhóm rỗng phải hiện ra để còn kéo thả vào. Thứ tự sắp
  // xếp đã áp ở `rows` nên các nhóm giữ nguyên thứ tự đó bên trong.
  const sections = useMemo(() => {
    const byGroup = new Map<string, typeof rows>()
    for (const r of rows) {
      const key = r.groupId ?? NO_GROUP
      if (!byGroup.has(key)) byGroup.set(key, [])
      byGroup.get(key)!.push(r)
    }
    const named = [...byGroup.entries()]
      .filter(([k]) => k !== NO_GROUP)
      .sort((a, b) => (a[1][0].groupName ?? '').localeCompare(b[1][0].groupName ?? '', 'vi'))
    const loose = byGroup.get(NO_GROUP)
    return [
      ...named.map(([key, items]) => ({ key, items, head: items[0] })),
      ...(loose ? [{ key: NO_GROUP, items: loose, head: null }] : []) // "Không nhóm" luôn cuối
    ]
  }, [rows])

  // Số thay đổi có màu: tăng = xanh, giảm = đỏ, không đổi = trắng.
  const deltaNum = (v: number): JSX.Element =>
    <span className={v > 0 ? 'text-ok' : v < 0 ? 'text-danger' : 'text-white'}>
      {v > 0 ? '+' : ''}{fmt(v)}
    </span>

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-[22px] pt-[18px] pb-3.5 flex items-center gap-2.5">
        <div className="text-[21px] font-bold">📈 Analytics</div>
        {collecting && <span className="text-[13px] text-accent2">⏳ {progress}</span>}
        {!collecting && progress && <span className="text-[13px] text-muted">{progress}</span>}
        <button
          onClick={collect}
          disabled={collecting}
          className="ml-auto accent-grad text-[#0a0b10] font-bold text-[14px] rounded-[10px] px-4 py-2.5 disabled:opacity-50"
        >
          {collecting ? 'Đang thu thập…' : '⟳ Thu thập ngay'}
        </button>
      </div>

      <div className="flex-1 overflow-auto hv-scroll px-[22px] pb-5">
        {/* bảng từng profile */}
        <div className="flex items-center mb-2.5">
          <Select
            value={sortBy}
            onChange={(v) => setSortBy(v as SortKey)}
            className="ml-auto w-[230px]"
            options={[
              { value: 'followers', label: 'Follower cao → thấp' },
              { value: 'today', label: 'Tăng hôm nay nhiều nhất' },
              { value: 'd30', label: 'Tăng nhiều nhất (30 ngày)' },
              { value: 'name', label: 'Tên A → Z' }
            ]}
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 Tìm profile…"
            className="ml-2.5 bg-[#101117] border border-border rounded-[10px] px-3 py-2 text-[14px] outline-none focus:border-[#3a3d6b] w-[220px]"
          />
        </div>
        <div className="bg-card border border-borderSoft rounded-[14px] overflow-hidden">
          {rows.length === 0 ? (
            <div className="text-muted text-[15px] px-5 py-6">Chưa có dữ liệu.</div>
          ) : (
            <table className="w-full text-[16px]">
              <thead className="text-muted text-left">
                <tr>
                  <th className="px-5 py-3.5 font-semibold text-[13px] uppercase tracking-wide w-[44px] text-center">#</th>
                  {/* Không có cột "Nhóm" riêng: hàng đã nằm dưới tiêu đề nhóm của
                      nó, và icon nhóm đứng cạnh avatar — giống tab Profile. */}
                  <th className="px-5 py-3.5 font-semibold text-[13px] uppercase tracking-wide w-[86px] text-center">Ảnh</th>
                  <th className="px-5 py-3.5 font-semibold text-[13px] uppercase tracking-wide">Profile</th>
                  <th className="px-5 py-3.5 font-semibold text-[13px] uppercase tracking-wide text-center">Follower</th>
                  <th className="px-5 py-3.5 font-semibold text-[13px] uppercase tracking-wide text-center">Hôm nay</th>
                  {/* 30 ngày = mốc mới nhất − mốc cũ nhất còn nằm trong 30 ngày qua.
                      Trước đây cột này là "Toàn kỳ" (so với mốc ĐẦU TIÊN từng thu
                      thập), con số càng ngày càng vô nghĩa khi lịch sử dài ra. */}
                  <th className="px-5 py-3.5 font-semibold text-[13px] uppercase tracking-wide text-center">30 ngày</th>
                  <th className="px-5 py-3.5 font-semibold text-[13px] uppercase tracking-wide text-center">Số dư</th>
                  <th className="px-5 py-3.5 font-semibold text-[13px] uppercase tracking-wide text-center">Kiếm tiền</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((sec) => {
                  const isCollapsed = collapsed.has(sec.key)
                  return (
                    <Fragment key={sec.key}>
                      <tr>
                        <td colSpan={COL_COUNT} className="p-0">
                          {/* width:0 + min-width:100% giữ ô colSpan này NGOÀI phép
                              tính bề rộng cột. Đã đo trên bản sao của bảng: thiếu
                              nó, một tên nhóm dài kéo các cột lệch tới 24px. */}
                          <div style={{ width: 0, minWidth: '100%' }} className="px-3 pt-2.5 pb-1">
                            <div
                              onClick={() => toggleGroup(sec.key)}
                              className="flex items-center gap-2 px-3 py-2 rounded-[10px] cursor-pointer select-none border border-borderSoft bg-[#12131b] hover:border-[#2b2d45]"
                            >
                              <span className="text-subtle w-3 text-center text-[13px]">
                                {isCollapsed ? '▸' : '▾'}
                              </span>
                              <GroupMark icon={sec.head?.groupIcon} color={sec.head?.groupColor} />
                              <span className={'text-[14px] font-semibold ' + (sec.head ? '' : 'text-subtle')}>
                                {sec.head?.groupName ?? 'Không nhóm'}
                              </span>
                              <span className="rounded-full border border-border bg-[#1b1c25] px-2 py-[1px] text-[11.5px] text-subtle">
                                {sec.items.length}
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed &&
                        sec.items.map((r, i) => (
                          <tr key={r.profileId} className={i % 2 === 0 ? 'bg-[#0e0f15]' : ''}>
                            {/* Số thứ tự chạy lại từ 1 trong mỗi nhóm — đọc là "hạng
                                mấy trong nhóm này" theo kiểu sắp xếp đang chọn. */}
                    <td className="px-5 py-4 text-center text-muted tabular-nums">{i + 1}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-center gap-2">
                        {/* Ô icon giữ bề rộng cố định kể cả khi rỗng, nếu không
                            avatar của profile không nhóm sẽ lệch so với hàng khác. */}
                        <span className="w-[18px] flex items-center justify-center" title={r.groupName ?? ''}>
                          {r.groupId && <GroupMark icon={r.groupIcon} color={r.groupColor} size={15} />}
                        </span>
                        <Avatar src={r.avatar} name={r.name} />
                      </div>
                    </td>
                    <td className="px-5 py-4 font-semibold">{r.name}</td>
                    <td className="px-5 py-4 text-center">{r.has ? fmt(r.latest) : <span className="text-muted">—</span>}</td>
                    {/* Chưa có số liệu thì để "—" chứ không hiện "0": 0 nghĩa là "không
                        đổi", khác hẳn với "chưa thu thập được". */}
                    <td className="px-5 py-4 text-center">{r.has ? deltaNum(r.dToday) : <span className="text-muted">—</span>}</td>
                    <td className="px-5 py-4 text-center">{r.has30 ? deltaNum(r.d30) : <span className="text-muted">—</span>}</td>
                    {/* Hiện NGUYÊN VĂN chuỗi TikTok trả về. Số dư của tài khoản
                        khác nhau có thể khác đơn vị tiền, và nhãn trạng thái đổi
                        theo ngôn ngữ profile — diễn giải lại chỉ tạo cơ hội sai. */}
                    <td className="px-5 py-4 text-center tabular-nums">
                      {r.balance || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-5 py-4 text-center text-[13px]">
                      {(() => {
                        if (!r.monetization && r.monetizationActive === null) {
                          return <span className="text-muted">—</span>
                        }
                        // Cờ từ DOM là nguồn chính; chỉ đoán qua chữ khi không có.
                        const on = r.monetizationActive ?? guessActiveFromLabel(r.monetization)
                        // title = chuỗi gốc TikTok, để đối chiếu khi nghi ngờ.
                        if (on === null) return <span title={r.monetization}>{r.monetization}</span>
                        return (
                          <span
                            title={r.monetization}
                            className={
                              'rounded-full px-2.5 py-[3px] text-[12px] font-semibold border ' +
                              (on
                                ? 'border-[#2c5443] bg-[rgba(52,211,153,.12)] text-ok'
                                : 'border-border bg-[#101117] text-subtle')
                            }
                          >
                            {on ? 'Đã kích hoạt' : 'Chưa kích hoạt'}
                          </span>
                        )
                      })()}
                    </td>
                          </tr>
                        ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
