import { useEffect, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

// ---- Confirm toàn cục (thay window.confirm) ----
interface ConfirmOpts {
  title?: string
  message: React.ReactNode
  confirmText?: string
  cancelText?: string
  /** Bật lựa chọn thứ ba (nút chính, phải nhất). Chỉ confirmDialogEx đọc được. */
  altText?: string
  danger?: boolean
}
/** 'alt' chỉ xảy ra khi opts có altText. */
export type ConfirmResult = 'confirm' | 'alt' | 'cancel'

let openConfirm: ((o: ConfirmOpts) => Promise<ConfirmResult>) | null = null

/** Mở hộp xác nhận theo theme, trả về Promise<boolean>. Dùng: if (!(await confirmDialog({message}))) return */
export function confirmDialog(o: ConfirmOpts): Promise<boolean> {
  return openConfirm ? openConfirm(o).then((r) => r === 'confirm') : Promise.resolve(false)
}

/** Như confirmDialog nhưng phân biệt được lựa chọn thứ ba (`altText`). */
export function confirmDialogEx(o: ConfirmOpts): Promise<ConfirmResult> {
  return openConfirm ? openConfirm(o) : Promise.resolve('cancel')
}

// ---- Toast toàn cục (thay window.alert) ----
type ToastType = 'info' | 'error' | 'success' | 'warning'
interface Toast {
  id: number
  msg: string
  type: ToastType
  /** Đang chạy animation bay ra, chưa gỡ khỏi DOM. */
  out?: boolean
}

/** Toast nằm bao lâu trước khi bắt đầu bay ra, và animation bay ra dài bao lâu
 *  (phải khớp với .hv-toast-out trong index.css). */
const TOAST_HOLD_MS = 3000
const TOAST_OUT_MS = 280

/** Khoảng cách tối thiểu giữa hai lần bay ra.
 *
 *  Không có nó thì mấy toast bắn ra cùng một nhịp (ví dụ lưu xong 3 thứ một
 *  lượt) sẽ hết giờ cùng lúc và bay đi thành một khối. Ép mỗi cái ra sau cái
 *  trước một quãng thì mắt đọc được là chúng đi lần lượt. */
const TOAST_STAGGER_MS = 140
/** Mốc bay ra của toast gần nhất đã hẹn giờ, để cái sau xếp hàng sau nó. */
let nextExitAt = 0

/** Chỉ tô VIỀN TRÁI — thân toast giữ nguyên nền tối như mọi khung khác trong
 *  app, để màu trạng thái là thứ duy nhất đập vào mắt.
 *
 *  Dùng TOKEN của theme (ok/warn/danger/accent2) chứ không phải mã màu cứng:
 *  sau này chỉnh bảng màu trong tailwind.config.js thì toast tự đi theo, không
 *  bị bỏ quên thành hai sắc lệch nhau. */
const TOAST_EDGE: Record<ToastType, string> = {
  success: 'border-l-ok',
  warning: 'border-l-warn',
  error: 'border-l-danger',
  info: 'border-l-accent2',
}

let seq = 1
const toastListeners = new Set<(t: Toast) => void>()

export function showToast(msg: string, type: ToastType = 'info'): void {
  const t: Toast = { id: seq++, msg, type }
  toastListeners.forEach((l) => l(t))
}

/** Mount MỘT lần ở App: cung cấp confirm + toast cho toàn app. */
export function UiDialogsHost(): JSX.Element {
  const [confirmState, setConfirmState] = useState<{
    o: ConfirmOpts
    resolve: (v: ConfirmResult) => void
  } | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    openConfirm = (o) => new Promise<ConfirmResult>((resolve) => setConfirmState({ o, resolve }))
    const onToast = (t: Toast): void => {
      // Nối vào CUỐI mảng: cột xếp từ trên xuống và neo ở đáy màn hình, nên cái
      // mới luôn hiện sát dưới cùng và đẩy mấy cái cũ lên trên.
      setToasts((cur) => [...cur, t])
      // Nằm đủ 3 giây, nhưng không được ra cùng lúc với cái ngay trước nó.
      const now = Date.now()
      const exitAt = Math.max(now + TOAST_HOLD_MS, nextExitAt + TOAST_STAGGER_MS)
      nextExitAt = exitAt
      const hold = exitAt - now
      // Hai nhịp: bật cờ `out` cho animation chạy, xong mới gỡ khỏi DOM. Gỡ
      // thẳng thì toast biến mất đột ngột, không kịp thấy nó bay đi đâu.
      setTimeout(() => setToasts((cur) => cur.map((x) => (x.id === t.id ? { ...x, out: true } : x))), hold)
      setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== t.id)), hold + TOAST_OUT_MS)
    }
    toastListeners.add(onToast)
    return () => {
      openConfirm = null
      toastListeners.delete(onToast)
    }
  }, [])

  const finish = (v: ConfirmResult): void => {
    confirmState?.resolve(v)
    setConfirmState(null)
  }

  return (
    <>
      {confirmState && (
        <ConfirmDialog
          {...confirmState.o}
          onConfirm={() => finish('confirm')}
          onCancel={() => finish('cancel')}
          onAlt={confirmState.o.altText ? () => finish('alt') : undefined}
        />
      )}
      <div className="fixed bottom-5 right-5 z-[80] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              'pointer-events-auto max-w-[380px] rounded-[10px] px-4 py-2.5 text-[13px] text-[#c7c8d4] ' +
              'bg-[#12131b] shadow-2xl whitespace-pre-line border-l-4 ' +
              TOAST_EDGE[t.type] +
              (t.out ? ' hv-toast-out' : ' hv-toast')
            }
          >
            {t.msg}
          </div>
        ))}
      </div>
    </>
  )
}
