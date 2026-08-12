import { useEffect, useState } from 'react'
import { showToast } from '../../components/uiDialogs'
import type { UpdateInfo, UpdateState } from '@shared/types'
import { Row, Section, Warn } from './settingUi'

/** Câu mô tả trạng thái, hiện ở cột trái cạnh nút. */
function label(s: UpdateState): string {
  switch (s.kind) {
    case 'idle':
      return 'Chưa kiểm tra lần nào trong phiên này'
    case 'checking':
      return 'Đang kiểm tra…'
    case 'latest':
      return 'Bạn đang dùng bản mới nhất'
    case 'available':
      return `Đã có bản ${s.newVersion}`
    case 'downloading':
      return `Đang tải… ${s.percent}%`
    case 'downloaded':
      return `Đã tải xong bản ${s.newVersion}`
    case 'error':
      return s.message
    case 'unsupported':
      return s.note
  }
}

/**
 * Thanh tiến trình tải. Tự dựng bằng div chứ không dùng <progress> — thẻ mặc
 * định của browser không theo được theme và mỗi hệ điều hành vẽ một kiểu.
 */
function Bar({ percent }: { percent: number }): JSX.Element {
  return (
    <div className="h-[6px] rounded-full bg-[rgba(255,255,255,.07)] overflow-hidden">
      <div
        className="h-full accent-grad transition-[width] duration-200"
        style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
      />
    </div>
  )
}

/**
 * Cập nhật app.
 *
 * App tự kiểm tra lúc khởi động; mục này để ép kiểm ngay và để thao tác tải/cài.
 * Nút cài bị khóa khi hàng đợi còn việc: quitAndInstall() đóng app ngay lập tức,
 * làm thế giữa một phiên upload là mất trắng công đang chạy.
 */
export function UpdateSection(): JSX.Element {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      window.hnv.update.info().then((v) => {
        if (!alive) return
        // CHỈ đồng bộ các field mà info() là nguồn thật (current, canInstall,
        // installBlockedReason) — KHÔNG đè `state`. info() trả một snapshot lấy
        // lúc gọi IPC; onQueueUpdate gọi load() này liên tục mỗi khi hàng đợi có
        // sự kiện. Nếu quá trình downloading→downloaded xảy ra đúng lúc roundtrip
        // đang bay, snapshot cũ (vẫn 'downloading') ghi đè state đúng vừa nhận
        // qua onUpdateState — và vì không còn state event nào bắn tiếp, nút kẹt ở
        // "Đang tải…" vĩnh viễn tới khi tab bị remount (finding IMPORTANT 5).
        // `state` chỉ được cập nhật qua onUpdateState bên dưới, nơi main đẩy trực
        // tiếp mỗi lần trạng thái đổi thật.
        setInfo((prev) => (prev ? { ...v, state: prev.state } : v))
      })
    }
    load()
    // Trạng thái do main đẩy sang (tiến trình tải, kết quả kiểm tra nền).
    const offState = window.hnv.onUpdateState((s) =>
      setInfo((prev) => (prev ? { ...prev, state: s } : prev))
    )
    // Hàng đợi đổi → canInstall có thể đổi theo.
    const offQueue = window.hnv.onQueueUpdate(load)
    // Profile mở/đóng cũng đổi canInstall, nhưng KHÔNG có sự kiện nào cho việc
    // đó tới được đây: onQueueUpdate chỉ nói về hàng đợi, còn profile:status chỉ
    // bắn cho profile mở qua nút "Mở" — không bắn cho phiên do đăng nhập hay
    // đồng bộ mở ra. Đo thật: mở một profile rồi đóng lại, ô cảnh báo vàng vẫn
    // đứng nguyên và nút cài vẫn khóa cho tới khi chuyển tab cho khối này
    // remount. Nhịp hỏi lại này là thứ duy nhất bao được mọi đường mở trình
    // duyệt. Chỉ chạy khi bản tải xong đang bị chặn — hết chặn là dừng.
    const off = window.hnv.onProfileStatus(load)
    return () => {
      alive = false
      offState()
      offQueue()
      off()
    }
  }, [])

  // Nhịp hỏi lại khi nút cài đang bị chặn. Tách riêng khỏi effect trên vì nó
  // phụ thuộc trạng thái, còn effect trên chỉ chạy một lần lúc mount.
  useEffect(() => {
    if (info?.state.kind !== 'downloaded' || info.canInstall) return
    const t = setInterval(() => {
      window.hnv.update
        .info()
        .then((v) => setInfo((prev) => (prev ? { ...v, state: prev.state } : v)))
    }, 2000)
    return () => clearInterval(t)
  }, [info?.state.kind, info?.canInstall])

  const check = async (): Promise<void> => {
    setBusy(true)
    try {
      const s = await window.hnv.update.check()
      if (s.kind === 'latest') showToast('Bạn đang dùng bản mới nhất', 'success')
      if (s.kind === 'available') showToast(`Đã có bản ${s.newVersion}`, 'success')
      if (s.kind === 'error') showToast(s.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const download = async (): Promise<void> => {
    setBusy(true)
    try {
      const s = await window.hnv.update.download()
      if (s.kind === 'error') showToast(s.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const install = async (): Promise<void> => {
    // Nút disabled theo info?.canInstall (snapshot renderer) nên bình thường
    // không bấm được lúc bị chặn — nhưng snapshot đó là async, có thể lệch với
    // main đúng lúc job vừa bắt đầu chạy. installNow() ở main mới là chốt chặn
    // thật; nếu bị từ chối phải báo rõ bằng toast, không được im lặng không làm
    // gì (finding IMPORTANT 3) — người dùng bấm mà app không phản hồi gì thì
    // tưởng app treo, bấm lại nhiều lần.
    const r = await window.hnv.update.install()
    if (!r.ok) showToast(r.reason, 'error')
  }

  const state: UpdateState = info?.state ?? { kind: 'idle' }
  const checking = busy || state.kind === 'checking'
  const downloading = state.kind === 'downloading'

  return (
    <Section icon="sync" title="Phiên bản">
      <Row label="Phiên bản đang chạy">
        <span className="text-[12.5px] text-muted">{info?.current ?? '…'}</span>
      </Row>

      <Row label="Tự kiểm tra bản mới">
        <span className="text-[12.5px] text-muted">Mỗi lần mở app</span>
      </Row>

      {downloading && <Bar percent={state.percent} />}

      {state.kind === 'downloaded' && !info?.canInstall && (
        <Warn>
          {info?.installBlockedReason === 'profiles'
            ? 'Đang có profile mở trình duyệt. Đóng hết các phiên đang chạy rồi hãy cài — khởi động lại lúc này sẽ hard-kill trình duyệt và có thể làm hỏng dữ liệu phiên đang mở.'
            : 'Hàng đợi đang có việc chạy. Đợi chạy xong rồi hãy cài — khởi động lại lúc này sẽ làm hỏng phiên đang chạy.'}
        </Warn>
      )}

      <div className="flex items-center gap-3 pt-1">
        <span
          className={
            'text-[12.5px] mr-auto ' +
            (state.kind === 'error' ? 'text-warn' : 'text-muted')
          }
        >
          {label(state)}
        </span>

        {state.kind === 'downloaded' ? (
          <button
            onClick={install}
            disabled={!info?.canInstall}
            className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-5 h-9 text-[13.5px] disabled:opacity-40"
          >
            Cài đặt & khởi động lại
          </button>
        ) : state.kind === 'downloading' ? (
          // Nhánh riêng — không rơi vào nút "Kiểm tra cập nhật" mặc định, vì lúc này
          // `busy` (đặt bởi handler download()) vẫn true nên sẽ đọc nhầm thành checking.
          <button
            disabled
            className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-5 h-9 text-[13.5px] disabled:opacity-40"
          >
            Đang tải…
          </button>
        ) : state.kind === 'available' ? (
          // disabled + đổi chữ ngay khi `busy` bật (download() set trước khi await) —
          // click phải có phản hồi thấy được NGAY, không đợi tới sự kiện
          // download-progress đầu tiên mới đổi UI. Redirect + chunk đầu của
          // electron-updater dễ mất hơn 1 giây; im lặng suốt khoảng đó khiến người
          // dùng tưởng app treo và bấm lại (finding IMPORTANT 4).
          <button
            onClick={download}
            disabled={busy}
            className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-5 h-9 text-[13.5px] disabled:opacity-40"
          >
            {busy ? 'Đang tải…' : 'Tải về'}
          </button>
        ) : (
          <button
            onClick={check}
            disabled={checking || state.kind === 'unsupported'}
            className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-5 h-9 text-[13.5px] disabled:opacity-40"
          >
            {checking ? 'Đang kiểm tra…' : 'Kiểm tra cập nhật'}
          </button>
        )}
      </div>
    </Section>
  )
}
