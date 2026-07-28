// Hộp thoại xác nhận theo theme của app (thay cho window.confirm mặc định).
export function ConfirmDialog({
  title = 'Xác nhận',
  message,
  confirmText = 'Xóa',
  cancelText = 'Hủy',
  danger = true,
  onConfirm,
  onCancel
}: {
  title?: string
  message: React.ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-[420px] bg-[#0d0e14] border border-border rounded-[14px] shadow-2xl overflow-hidden">
        <div className="px-[22px] py-4 border-b border-borderSoft text-[16px] font-bold">{title}</div>
        <div className="px-[22px] py-5 text-[14px] text-subtle whitespace-pre-line leading-relaxed">{message}</div>
        <div className="px-[22px] py-3.5 border-t border-borderSoft flex gap-2.5 justify-end">
          <button
            onClick={onCancel}
            className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-[18px] py-2.5 text-[14px]"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={
              'rounded-[9px] px-[22px] py-2.5 text-[14px] font-bold ' +
              (danger
                ? 'text-danger border border-[#5a2c33] bg-[rgba(251,113,133,.12)]'
                : 'accent-grad text-[#0a0b10]')
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
