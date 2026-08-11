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
      window.hnv.update.info().then((v) => alive && setInfo(v))
    }
    load()
    // Trạng thái do main đẩy sang (tiến trình tải, kết quả kiểm tra nền).
    const offState = window.hnv.onUpdateState((s) =>
      setInfo((prev) => (prev ? { ...prev, state: s } : prev))
    )
    // Hàng đợi đổi → canInstall có thể đổi theo.
    const offQueue = window.hnv.onQueueUpdate(load)
    return () => {
      alive = false
      offState()
      offQueue()
    }
  }, [])

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
    await window.hnv.update.install()
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
          Hàng đợi đang có việc chạy. Đợi chạy xong rồi hãy cài — khởi động lại lúc này
          sẽ làm hỏng phiên đang chạy.
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
        ) : state.kind === 'available' ? (
          <button
            onClick={download}
            disabled={downloading}
            className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-5 h-9 text-[13.5px] disabled:opacity-40"
          >
            {downloading ? 'Đang tải…' : 'Tải về'}
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
