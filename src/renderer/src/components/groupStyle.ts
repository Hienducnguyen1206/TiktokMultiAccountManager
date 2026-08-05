/**
 * Bảng màu, bảng icon và trạng thái thu/mở nhóm — dùng chung cho mọi nơi hiển
 * thị nhóm.
 *
 * Sống ở components/ chứ không nằm trong một tab cụ thể: GroupSelect (panel cài
 * đặt profile), GroupDialog (hộp thoại cài đặt nhóm), cây thư mục ở tab Profile
 * và ở tab Analytics đều đọc từ đây, nên chúng không thể trôi ra khỏi nhau.
 */

/** id giả cho rổ "Không nhóm" — profile không nhóm có groupId === null, mà null
 *  không dùng làm khóa Map/Set cho tiện được. */
export const NO_GROUP = '__none__'

/** Khóa localStorage giữ danh sách id nhóm ĐANG THU. Lưu phía thu (không phải
 *  phía mở) để nhóm mới tạo mặc định mở ra — người dùng vừa tạo thì muốn nhìn
 *  thấy nó. Dùng chung cho cả tab Profile lẫn tab Analytics: thu một nhóm ở bên
 *  này thì bên kia cũng thu, vì đó là cùng một nhóm. */
const COLLAPSED_KEY = 'hnv.profileTab.collapsedGroups'

export function loadCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set() // localStorage hỏng/JSON lỗi — mở hết, không phải lỗi đáng chặn
  }
}

export function saveCollapsedGroups(ids: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]))
  } catch {
    // hết quota / chế độ riêng tư — trạng thái thu vẫn đúng trong phiên này
  }
}

/** 14 màu, xếp theo vòng sắc để hàng màu trong hộp thoại đọc như một dải liền. */
export const GROUP_COLORS = [
  '#818cf8',
  '#6366f1',
  '#a78bfa',
  '#c084fc',
  '#e879f9',
  '#f472b6',
  '#f43f5e',
  '#fb7185',
  '#fb923c',
  '#facc15',
  '#a3e635',
  '#34d399',
  '#22d3ee',
  '#38bdf8'
]

/** 24 emoji. Rỗng cũng là một lựa chọn hợp lệ — khi đó nhóm hiện chấm tròn màu. */
export const GROUP_ICONS = [
  '📁',
  '⭐',
  '🎬',
  '🔥',
  '💰',
  '🚀',
  '🎯',
  '📺',
  '🎵',
  '🛒',
  '🌏',
  '🧪',
  '💼',
  '🎮',
  '📦',
  '🔒',
  '⚡',
  '🏆',
  '🌙',
  '☀️',
  '🍀',
  '🐟',
  '🧊',
  '🎨'
]
