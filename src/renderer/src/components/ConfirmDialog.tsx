// Hộp thoại xác nhận theo theme của app (thay cho window.confirm mặc định).
export function ConfirmDialog({
  title = 'Xác nhận',
  message,
  confirmText = 'Xóa',
  cancelText = 'Hủy',
  altText,
  danger = true,
  onConfirm,
  onCancel,
  onAlt
}: {
  title?: string
  message: React.ReactNode
  confirmText?: string
  cancelText?: string
  /** Lựa chọn thứ BA, nằm phải nhất và mang kiểu nút chính. Bỏ trống thì hộp
   *  thoại chỉ có hai nút như trước. */
  altText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
  onAlt?: () => void
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-[420px] bg-[#0d0e14] border border-border rounded-[14px] shadow-2xl overflow-hidden">
        <div className="px-[22px] py-4 border-b border-borderSoft text-[16px] font-bold">{title}</div>
        <div className="px-[22px] py-5 text-[14px] text-subtle whitespace-pre-line leading-relaxed">{message}</div>
        <div className="px-[22px] py-3.5 border-t border-borderSoft flex gap-2.5 items-center">
          {/* Lựa chọn thứ ba nằm góc TRÁI, tách hẳn khỏi cặp Hủy/Xác nhận bên phải
              — nó là một hướng đi khác, không phải một mức độ của cùng một hành động. */}
          {altText && onAlt && (
            <button onClick={onAlt} className="accent-grad text-[#0a0b10] rounded-[9px] px-[22px] py-2.5 text-[14px] font-bold">
              {altText}
            </button>
          )}
          {/* Hai nút này dùng ĐÚNG bộ gradient của thanh công cụ, để hộp thoại nói
              cùng một thứ ngôn ngữ với phần còn lại của app: Hủy = vàng như nút
              Hoàn tác (bỏ việc đang làm), Lưu = xanh lá như nút Lưu.

              Nhánh danger vẫn đỏ — hộp thoại xóa dùng chung component này, đổi
              nó sang xanh là mất tín hiệu duy nhất phân biệt "ghi thêm" với
              "xóa mất". Chỉ đổi từ nền đỏ nhạt sang gradient đỏ cho đồng bộ. */}
          <button
            onClick={onCancel}
            className="ml-auto warn-grad text-[#2a1608] font-bold rounded-[9px] px-[18px] py-2.5 text-[14px]"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={
              'rounded-[9px] px-[22px] py-2.5 text-[14px] font-bold ' +
              (danger ? 'danger-grad text-[#2a0d12]' : 'ok-grad text-[#062018]')
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
