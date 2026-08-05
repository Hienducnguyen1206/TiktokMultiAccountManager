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
type ToastType = 'info' | 'error' | 'success'
interface Toast {
  id: number
  msg: string
  type: ToastType
}
let seq = 1
const toastListeners = new Set<(t: Toast) => void>()

export function showToast(msg: string, type: ToastType = 'info'): void {
  const t: Toast = { id: seq++, msg, type }
  toastListeners.forEach((l) => l(t))
}

/** Mount MỘT lần ở App: cung cấp confirm + toast cho toàn app. */
export function UiDialogsHost(): JSX.Element {
  const [confirmState, setConfirmState] = useState<{ o: ConfirmOpts; resolve: (v: ConfirmResult) => void } | null>(
    null
  )
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    openConfirm = (o) => new Promise<ConfirmResult>((resolve) => setConfirmState({ o, resolve }))
    const onToast = (t: Toast): void => {
      setToasts((cur) => [...cur, t])
      setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== t.id)), 4000)
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
              'pointer-events-auto max-w-[380px] rounded-[10px] px-4 py-2.5 text-[13px] shadow-2xl border whitespace-pre-line ' +
              (t.type === 'error'
                ? 'bg-[rgba(251,113,133,.12)] border-[#5a2c33] text-danger'
                : t.type === 'success'
                  ? 'bg-[rgba(52,211,153,.12)] border-[#2c5443] text-ok'
                  : 'bg-[#0d0e14] border-border text-[#c7c8d4]')
            }
          >
            {t.msg}
          </div>
        ))}
      </div>
    </>
  )
}
