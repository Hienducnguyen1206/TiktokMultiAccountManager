import type { TemplateType } from '@shared/types'
import { Icon, type IconName } from '../../components/Icon'

/**
 * Màu nhận dạng của từng loại template. Một nguồn duy nhất cho cả menu "+ Mới"
 * lẫn danh sách bên trái — tách ra hai chỗ là kiểu gì cũng có ngày lệch nhau.
 *
 * Ba dải cố ý khác hẳn tông: Upload lạnh (chính là dải thương hiệu), Warmup ấm,
 * Bulk tím-hồng. Nhìn màu là biết loại, không cần đọc chữ.
 */
export const TYPE_STYLE: Record<TemplateType, { label: string; icon: IconName; grad: string; ink: string }> = {
  'upload-video': {
    label: 'Đăng video',
    icon: 'upload',
    grad: 'linear-gradient(100deg,#818cf8,#22d3ee)',
    ink: '#0c1440',
  },
  warmup: {
    label: 'Nuôi account',
    icon: 'fire',
    grad: 'linear-gradient(100deg,#fb923c,#f43f5e)',
    ink: '#3a1206',
  },
  'bulk-video': {
    label: 'Chỉnh sửa quyền riêng tư',
    icon: 'clean',
    grad: 'linear-gradient(100deg,#a78bfa,#e879f9)',
    ink: '#2a0b3d',
  },
}

/** Viên nhãn gradient đặc, chữ tối đè lên — cùng lối với các nút accent-grad. */
export function TypeBadge({ type }: { type: TemplateType }): JSX.Element {
  const s = TYPE_STYLE[type]
  return (
    <span
      style={{ background: s.grad, color: s.ink }}
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold"
    >
      <Icon name={s.icon} filled size={13} />
      {s.label}
    </span>
  )
}
