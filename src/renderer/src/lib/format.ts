export function timeAgo(ts: number | null): string {
  if (!ts) return 'chưa dùng'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'vừa xong'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} phút trước`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} giờ trước`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} ngày trước`
  return `${Math.floor(d / 7)} tuần trước`
}
