/**
 * Ảnh đại diện TikTok của một profile.
 *
 * `src` là data URL lấy về lúc Đồng bộ (xem TikTokSync.readAvatar). Chưa đồng bộ
 * được thì hiện ô rỗng có icon mờ — cố ý không vẽ chữ cái đầu, để nhìn là biết
 * ngay hàng nào chưa có ảnh thật.
 *
 * Dùng chung cho tab Profile và tab Analytics, nên hai bảng luôn hiện cùng một
 * thứ với cùng kích cỡ.
 */
export function Avatar({ src, name, size = 36 }: { src: string; name: string; size?: number }): JSX.Element {
  return (
    <span
      className="rounded-full inline-flex items-center justify-center overflow-hidden bg-[#101117] border border-border align-middle shrink-0"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={name} className="w-full h-full object-cover" draggable={false} />
      ) : (
        <span className="text-muted leading-none" style={{ fontSize: Math.round(size * 0.42) }}>
          👤
        </span>
      )}
    </span>
  )
}
