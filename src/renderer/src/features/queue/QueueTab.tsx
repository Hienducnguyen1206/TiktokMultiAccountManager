import { Fragment, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { JOB_STAGES, type Job, type JobStatus, type QueueState } from '@shared/types'

/** Thanh tiến trình theo bước cho 1 job đang chạy. */
function StageTrack({ stage, status }: { stage: number; status: JobStatus }): JSX.Element {
  return (
    <div className="flex items-center flex-1 min-w-0 px-1.5">
      {JOB_STAGES.map((label, i) => {
        const done = status === 'done' || i < stage
        const now = status !== 'done' && i === stage
        const err = status === 'error' && i === stage
        const segDone = status === 'done' || i <= stage
        return (
          <Fragment key={label}>
            {i > 0 && (
              <div
                className={'h-0.5 flex-1 min-w-[16px] mx-2 rounded ' + (segDone ? 'bg-[#2c5443]' : 'bg-[#2b2d3a]')}
              />
            )}
            <div
              className={
                'flex items-center gap-2 whitespace-nowrap text-[13px] shrink-0 ' +
                (now ? 'text-white font-bold' : done ? 'text-subtle' : 'text-muted')
              }
            >
              <span
                className={
                  'w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold border-2 ' +
                  (err
                    ? 'bg-[rgba(251,113,133,.16)] border-[#5a2c33] text-danger'
                    : done
                      ? 'bg-[rgba(52,211,153,.16)] border-[#2c5443] text-ok'
                      : now
                        ? 'border-transparent text-[#0a0b10] accent-grad shadow-[0_0_10px_rgba(34,211,238,.45)]'
                        : 'border-[#3b3d4f] text-muted bg-[#0e0f15]')
                }
              >
                {err ? (
                  <Icon name="close" filled size={13} className="inline align-[-3px]" />
                ) : done ? (
                  <Icon name="check" filled size={13} className="inline align-[-3px]" />
                ) : (
                  i + 1
                )}
              </span>
              {label}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

/** Panel log dùng chung cho CẢ job đang chạy lẫn job trong bảng lịch sử.
 *  Trước đây markup này nằm trong nhánh render của job đang chạy nên job đã xong/lỗi
 *  không có cách nào xem lại log — đúng lúc cần nhất (job upload lỗi, muốn biết vì
 *  sao) thì chỉ còn một dòng lý do ngắn. Log vẫn luôn được lưu (cột `log` trong DB +
 *  IPC queue.jobLog), chỉ thiếu chỗ mở. */
function LogPanel({
  log,
  copied,
  onCopy,
  panelRef,
}: {
  log: string[]
  copied: boolean
  onCopy: () => void
  panelRef: React.RefObject<HTMLDivElement>
}): JSX.Element {
  return (
    <div
      ref={panelRef}
      className="relative border-t border-borderSoft bg-[#08090d] max-h-[180px] overflow-auto hv-scroll font-mono text-[11.5px] leading-relaxed px-3.5 py-2.5 text-[#9aa0b0]"
    >
      <button
        disabled={log.length === 0}
        onClick={onCopy}
        className="absolute top-2 right-2.5 bg-[#0e0f15] text-[#c7c8d4] border border-border rounded-md px-2 py-0.5 text-[11px] disabled:opacity-40"
      >
        {copied ? (
          <Icon name="check" filled size={14} className="inline align-[-3px]" />
        ) : (
          <>
            <Icon name="copy" filled size={14} className="inline align-[-3px] mr-1" />
            Copy
          </>
        )}
      </button>
      {log.length === 0 ? <div className="text-muted">— chưa có log —</div> : log.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  )
}

const PAGE_SIZE = 15

/** Nút −/+ của ô số luồng. */
const STEP_BTN =
  'w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-md text-[16px] leading-none ' +
  'bg-[#101117] border border-border text-[#c7c8d4] hover:border-[#3a3d6b] disabled:opacity-30'

export function QueueTab(): JSX.Element {
  const [jobs, setJobs] = useState<Job[]>([])
  const [state, setState] = useState<QueueState>({
    paused: false,
    maxConcurrency: 5,
    maxConcurrencyLimit: 10,
  })
  const [openId, setOpenId] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [page, setPage] = useState(0) // trang của "Hàng đợi & lịch sử"
  const logRef = useRef<HTMLDivElement>(null)

  const reload = async (): Promise<void> => {
    const [j, s] = await Promise.all([window.hnv.queue.list(), window.hnv.queue.state()])
    setJobs(j)
    setState(s)
  }

  useEffect(() => {
    reload()
    const offU = window.hnv.onQueueUpdate(() => reload())
    const offL = window.hnv.onJobLog((jobId, line) => {
      setOpenId((cur) => {
        if (cur === jobId) setLog((prev) => [...prev, line])
        return cur
      })
    })
    return () => {
      offU()
      offL()
    }
  }, [])

  useEffect(() => {
    if (openId) window.hnv.queue.jobLog(openId).then(setLog)
    else setLog([])
  }, [openId])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  const count = (s: JobStatus): number => jobs.filter((j) => j.status === s).length
  /** Job còn "sống" — có cái này thì Tạm dừng mới có nghĩa. */
  const active = count('running') + count('queued')
  /** Job đã kết thúc, dù xong hay lỗi — đúng tập mà clearDone() xóa. */
  const finished = count('done') + count('error')

  // Đặt số luồng và lấy NGAY giá trị main trả về: main kẹp lại trong [1,10] nên
  // nó mới là nguồn thật. Chờ sự kiện onQueueUpdate cũng được, nhưng gán luôn
  // thì con số không nhấp nháy giữa hai lần vẽ.
  const setThreads = async (n: number): Promise<void> => {
    const real = await window.hnv.queue.setMaxConcurrency(n)
    setState((s) => ({ ...s, maxConcurrency: real }))
  }
  const running = jobs.filter((j) => j.status === 'running').sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  // Bảng dưới liệt kê TẤT CẢ job (kể cả đang chạy) — job đang chạy xếp lên đầu.
  const rest = [...jobs].sort((a, b) => {
    const ra = a.status === 'running' ? 1 : 0
    const rb = b.status === 'running' ? 1 : 0
    if (ra !== rb) return rb - ra
    return b.createdAt - a.createdAt
  })
  const emptySlots = Math.max(0, state.maxConcurrency - running.length)

  // Phân trang 20 item/trang cho "Hàng đợi & lịch sử". Kẹp trang khi danh sách co lại.
  const totalPages = Math.max(1, Math.ceil(rest.length / PAGE_SIZE))
  const curPage = Math.min(page, totalPages - 1)
  const pageItems = rest.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE)

  const toggleLog = (id: string): void => setOpenId((cur) => (cur === id ? null : id))
  const copyLog = (): void => {
    navigator.clipboard.writeText(log.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-5 pt-4 pb-3 flex items-center gap-2.5">
        <div className="text-[21px] font-bold text-grad flex items-center gap-2">
          <Icon name="queue" filled size={24} className="icon-grad" />
          Hàng đợi
        </div>
        {/* Số luồng: chỉnh ngay tại đây chứ không giấu trong tab Cài đặt — nó là
            thứ người dùng vặn theo sức máy, và ngay dưới là dòng "x / N luồng"
            nên nhìn được hiệu quả tức thì. Trần lấy từ main, không ghi cứng. */}
        <div className="ml-auto flex items-center gap-1.5 bg-surface border border-border rounded-lg h-10 px-2">
          <span className="text-[12.5px] text-muted whitespace-nowrap">Số luồng</span>
          <button
            onClick={() => setThreads(state.maxConcurrency - 1)}
            disabled={state.maxConcurrency <= 1}
            aria-label="Giảm số luồng"
            className={STEP_BTN}
          >
            −
          </button>
          <span className="w-6 text-center text-[14px] font-bold tabular-nums">{state.maxConcurrency}</span>
          <button
            onClick={() => setThreads(state.maxConcurrency + 1)}
            disabled={state.maxConcurrency >= state.maxConcurrencyLimit}
            aria-label="Tăng số luồng"
            className={STEP_BTN}
          >
            +
          </button>
        </div>
        {/* Khoá khi KHÔNG có gì để dừng. Nhưng lúc đang tạm dừng thì luôn mở, kể
            cả hàng đợi rỗng: dừng lúc còn job rồi xoá sạch job đi mà nút cũng
            khoá theo thì hàng đợi kẹt ở trạng thái dừng, job mới thêm vào không
            bao giờ chạy và không còn cách nào bật lại. */}
        <button
          onClick={() => window.hnv.queue.setPaused(!state.paused)}
          disabled={!state.paused && active === 0}
          title={
            state.paused
              ? 'Cho hàng đợi chạy tiếp'
              : active === 0
                ? 'Không có job nào đang chạy hay đang chờ'
                : 'Dừng nhận job mới (job đang chạy vẫn chạy nốt)'
          }
          className="h-10 inline-flex items-center bg-surface text-[#c7c8d4] border border-border rounded-lg px-3.5 text-[13px] disabled:opacity-40"
        >
          {state.paused ? (
            <>
              <Icon name="play" filled size={15} className="inline align-[-3px] mr-1" />
              Tiếp tục
            </>
          ) : (
            <>
              <Icon name="pause" filled size={15} className="inline align-[-3px] mr-1" />
              Tạm dừng
            </>
          )}
        </button>
        {/* Nhãn nói "đã kết thúc" chứ không phải "xong": clearDone() xóa cả job LỖI
            (status done HOẶC error). Nhãn cũ "Xóa job xong" làm người dùng tưởng job
            lỗi được giữ lại để xem lý do. */}
        <button
          onClick={() => window.hnv.queue.clearDone()}
          disabled={finished === 0}
          title={finished === 0 ? 'Chưa có job nào kết thúc' : `Xóa ${finished} job đã xong hoặc lỗi`}
          className="h-10 inline-flex items-center warn-grad text-[#2a1608] font-bold rounded-lg px-3.5 text-[13px] disabled:opacity-40"
        >
          <Icon name="clean" filled size={16} className="inline align-[-3px] mr-1" />
          Xóa job đã kết thúc
        </button>
      </div>
      <div className="px-5 pb-3 flex gap-2 text-[13px]">
        <span className="rounded-full px-2.5 py-0.5 font-semibold text-ok bg-[rgba(52,211,153,.12)] border border-[#2c5443]">
          ● {count('running')} đang chạy
        </span>
        <span className="rounded-full px-2.5 py-0.5 font-semibold text-subtle bg-[#101117] border border-border">
          ○ {count('queued')} chờ
        </span>
        <span className="rounded-full px-2.5 py-0.5 font-semibold text-accent2 bg-[rgba(34,211,238,.10)] border border-[#2c4a55]">
          <Icon name="check" filled size={14} className="inline align-[-3px] mr-1" /> {count('done')} xong
        </span>
        <span className="rounded-full px-2.5 py-0.5 font-semibold text-danger bg-[rgba(251,113,133,.10)] border border-[#5a2c33]">
          <Icon name="close" filled size={14} className="inline align-[-3px] mr-1" /> {count('error')} lỗi
        </span>
      </div>

      <div className="flex-1 overflow-auto hv-scroll px-5 pb-4">
        <>
          <div className="text-[12px] uppercase tracking-wide text-muted font-bold mt-2.5 mb-2.5">
            Đang chạy · {running.length} / {state.maxConcurrency} luồng
          </div>
          <div className="flex flex-col gap-2.5">
            {running.map((j) => {
              const open = openId === j.id
              return (
                <div
                  key={j.id}
                  className={
                    'bg-[#13151d] border border-[#2b2d3a] rounded-xl overflow-hidden border-l-[3px] ' +
                    (j.status === 'error' ? 'border-l-danger' : 'border-l-accent2')
                  }
                >
                  <div className="flex items-center gap-3.5 px-3.5 py-3">
                    <span className="w-2.5 h-2.5 rounded-full bg-ok shadow-[0_0_8px_#34d399] shrink-0" />
                    <span className="font-bold text-[15px] w-24 shrink-0 truncate">{j.profileName}</span>
                    <span
                      className="w-[150px] shrink-0 text-[11.5px] text-subtle truncate"
                      title={j.currentVideo ?? ''}
                    >
                      <Icon name="film" filled size={15} className="inline align-[-3px] mr-1" />
                      {j.currentVideo ?? '…'}
                    </span>
                    <StageTrack stage={j.stage} status={j.status} />
                    <div className="flex items-center gap-3 shrink-0 ml-1.5">
                      <button
                        onClick={() => toggleLog(j.id)}
                        className={
                          'text-[12px] font-semibold rounded-md px-2.5 py-1 border ' +
                          (open
                            ? 'text-accent2 border-[#2c4a55] bg-[rgba(34,211,238,.10)]'
                            : 'text-[#c7c8d4] border-border bg-surface')
                        }
                      >
                        <Icon name="doc" filled size={15} className="inline align-[-3px] mr-1" />
                        {open ? 'Ẩn log' : 'Xem log'}
                      </button>
                      <button
                        onClick={() => window.hnv.queue.cancel(j.id)}
                        className="text-[12px] font-semibold rounded-md px-2.5 py-1 border text-danger border-[#5a2c33] bg-[rgba(251,113,133,.12)]"
                      >
                        <Icon name="stop" filled size={15} className="inline align-[-3px] mr-1" />
                        Dừng
                      </button>
                    </div>
                  </div>
                  {open && <LogPanel log={log} copied={copied} onCopy={copyLog} panelRef={logRef} />}
                </div>
              )
            })}

            {Array.from({ length: emptySlots }).map((_, i) => (
              <div
                key={'empty' + i}
                className="border border-dashed border-[#23242e] rounded-xl text-muted flex items-center justify-center text-[12.5px] py-3"
              >
                ⊕ Slot trống
              </div>
            ))}
          </div>

          <div className="text-[12px] uppercase tracking-wide text-muted font-bold mt-5 mb-2.5">
            Hàng đợi &amp; lịch sử{rest.length > 0 ? ` · ${rest.length}` : ''}
          </div>
          {rest.length === 0 ? (
            <div className="border border-dashed border-[#23242e] rounded-xl text-muted flex items-center justify-center text-[12.5px] py-5">
              Chưa có job nào — chạy template hoặc đợi schedule kích hoạt.
            </div>
          ) : (
            <>
              <table className="w-full text-[13.5px]" style={{ borderCollapse: 'separate', borderSpacing: '0 6px' }}>
                <tbody>
                  {pageItems.map((j) => (
                    <Fragment key={j.id}>
                      <tr className="bg-[#0e0f15]">
                        <td className="px-3 py-2.5 rounded-l-[9px] font-bold w-[140px]">{j.profileName}</td>
                        <td className="px-3 py-2.5">
                          <Icon name="videocam" filled size={15} className="inline align-[-3px] mr-1" />
                          {j.templateName}
                        </td>
                        <td className="px-3 py-2.5">
                          {j.status === 'queued' && <span className="text-subtle">○ Đang chờ</span>}
                          {j.status === 'running' && (
                            <span className="text-ok">
                              ● Đang chạy
                              {j.currentVideo ? (
                                <span className="text-muted">
                                  {' '}
                                  · <Icon name="film" filled size={15} className="inline align-[-3px] mr-1" />
                                  {j.currentVideo}
                                </span>
                              ) : (
                                ''
                              )}
                            </span>
                          )}
                          {j.status === 'done' && (
                            <span className="text-accent2">
                              <Icon name="check" filled size={15} className="inline align-[-3px] mr-1" />
                              Hoàn tất
                              {j.currentVideo ? <span className="text-muted"> · đã đăng {j.currentVideo}</span> : ''}
                            </span>
                          )}
                          {j.status === 'error' && (
                            <span className="text-danger">
                              <Icon name="close" filled size={15} className="inline align-[-3px] mr-1" />
                              Lỗi
                              {j.error ? <span className="text-muted"> · {j.error}</span> : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 rounded-r-[9px] text-right whitespace-nowrap">
                          {/* Job chờ chưa chạy nên chắc chắn chưa có log — không mời bấm. */}
                          {j.status !== 'queued' && (
                            <span
                              onClick={() => toggleLog(j.id)}
                              className={'cursor-pointer mr-3.5 ' + (openId === j.id ? 'text-accent2' : 'text-muted')}
                            >
                              <Icon name="doc" filled size={15} className="inline align-[-3px] mr-1" />
                              {openId === j.id ? 'Ẩn log' : 'Xem log'}
                            </span>
                          )}
                          {j.status === 'queued' && (
                            <span onClick={() => window.hnv.queue.cancel(j.id)} className="text-muted cursor-pointer">
                              <Icon name="close" filled size={14} className="inline align-[-3px] mr-1" />
                              Bỏ
                            </span>
                          )}
                          {j.status === 'running' && (
                            <span onClick={() => window.hnv.queue.cancel(j.id)} className="text-danger cursor-pointer">
                              <Icon name="stop" filled size={14} className="inline align-[-3px] mr-1" />
                              Dừng
                            </span>
                          )}
                          {(j.status === 'error' || j.status === 'done') && (
                            <span onClick={() => window.hnv.queue.retry(j.id)} className="text-accent2 cursor-pointer">
                              ↻ Chạy lại
                            </span>
                          )}
                        </td>
                      </tr>
                      {openId === j.id && (
                        <tr>
                          <td colSpan={4} className="p-0 rounded-[9px] overflow-hidden">
                            <LogPanel log={log} copied={copied} onCopy={copyLog} panelRef={logRef} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-1.5 text-[13px]">
                  <button
                    onClick={() => setPage(Math.max(0, curPage - 1))}
                    disabled={curPage === 0}
                    className="bg-surface text-[#c7c8d4] border border-border rounded-lg px-3 py-1.5 disabled:opacity-40"
                  >
                    ‹ Trước
                  </button>
                  <span className="text-subtle px-1">
                    Trang {curPage + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(totalPages - 1, curPage + 1))}
                    disabled={curPage >= totalPages - 1}
                    className="bg-surface text-[#c7c8d4] border border-border rounded-lg px-3 py-1.5 disabled:opacity-40"
                  >
                    Sau ›
                  </button>
                </div>
              )}
            </>
          )}
        </>
      </div>
    </div>
  )
}
