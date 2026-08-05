/**
 * Dấu hiệu nhận biết một nhóm: icon nếu nhóm có đặt, nếu không thì chấm tròn màu
 * như trước đây. Dùng ở cây thư mục tab Profile, dropdown chọn nhóm trong panel
 * cài đặt, và cột Nhóm ở tab Analytics — để ba nơi luôn vẽ giống nhau.
 */
export function GroupMark({
  icon,
  color,
  size = 14
}: {
  icon?: string | null
  color?: string | null
  size?: number
}): JSX.Element {
  if (icon) {
    return (
      <span style={{ fontSize: size }} className="leading-none">
        {icon}
      </span>
    )
  }
  return (
    <span style={{ color: color ?? '#818cf8', fontSize: size }} className="leading-none">
      ●
    </span>
  )
}
