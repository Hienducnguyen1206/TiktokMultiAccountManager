import {
  US, GB, VN, JP, KR, IN, BR, ID, TH, PH, MX, DE, FR, ES, PT, RU
} from 'country-flag-icons/react/3x2'

/**
 * Sprite SVG icon nét dùng chung cho tab Search Kênh — render 1 lần, các nơi khác
 * tham chiếu bằng <use href="#id" />.
 *
 * Path lấy từ bộ Lucide gốc (@iconify-json/lucide) rồi dán vào đây, nên không có
 * dependency lúc chạy. fill/stroke/stroke-width do CSS .cs-app svg:not(.cs-flag) lo.
 * Muốn đổi/thêm icon thì lấy path từ đúng bộ, đừng vẽ tay.
 *
 * Cờ quốc gia KHÔNG nằm ở đây: dùng bộ country-flag-icons. Không dùng emoji cờ được
 * vì Windows không có glyph cho cặp regional indicator — 🇺🇸 chỉ hiện ra chữ "US".
 */
export function CsSprite(): JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <symbol id="i-paw" viewBox="0 0 24 24"><circle cx="11" cy="4" r="2" /><circle cx="18" cy="8" r="2" /><circle cx="20" cy="16" r="2" /><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045q-.64-2.065-2.7-2.705A3.5 3.5 0 0 1 5.5 10Z" /></symbol>
      <symbol id="i-laugh" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M18 13a6 6 0 0 1-6 5a6 6 0 0 1-6-5zM9 9h.01M15 9h.01" /></symbol>
      <symbol id="i-clap" viewBox="0 0 24 24"><path d="m12.296 3.464l3.02 3.956M20.2 6L3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3zM3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm3.18-5.724l3.1 3.899" /></symbol>
      <symbol id="i-ball" viewBox="0 0 24 24"><path d="M11 7a16 16 20 0 1 10.98 4.362M12 12a13 13 0 0 1-8.66 5m13.49-3.366a16 16 0 0 1-9.267 7.328" /><path d="M20.66 17A13 13 0 0 0 12 12a13 13 0 0 1 0-10M8.17 15.366a16 16 0 0 1-1.713-11.69" /><circle cx="12" cy="12" r="10" /></symbol>
      <symbol id="i-gamepad" viewBox="0 0 24 24"><path d="M6 11h4M8 9v4m7-1h.01M18 10h.01m-.69-5H6.68a4 4 0 0 0-3.978 3.59l-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258q-.01-.075-.017-.151A4 4 0 0 0 17.32 5" /></symbol>
      <symbol id="i-music" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></symbol>
      <symbol id="i-food" viewBox="0 0 24 24"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20m14-7V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2zm0 0v7" /></symbol>
      <symbol id="i-flower" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 16.5A4.5 4.5 0 1 1 7.5 12A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5a4.5 4.5 0 1 1-4.5 4.5m0-9V9m-4.5 3H9m7.5 0H15m-3 4.5V15M8 8l1.88 1.88m4.24 0L16 8m-8 8l1.88-1.88m4.24 0L16 16" /></symbol>
      <symbol id="i-cpu" viewBox="0 0 24 24"><path d="M12 20v2m0-20v2m5 16v2m0-20v2M2 12h2m-2 5h2M2 7h2m16 5h2m-2 5h2M20 7h2M7 20v2M7 2v2" /><rect width="16" height="16" x="4" y="4" rx="2" /><rect width="8" height="8" x="8" y="8" rx="1" /></symbol>
      <symbol id="i-dumbbell" viewBox="0 0 24 24"><path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829zM2.5 21.5l1.4-1.4M20.1 3.9l1.4-1.4M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829zM9.6 14.4l4.8-4.8" /></symbol>
      <symbol id="i-plane" viewBox="0 0 24 24"><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8L4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1l3 2l2 3l1-1v-3l3-2l3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2" /></symbol>
      <symbol id="i-grad" viewBox="0 0 24 24"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0zM22 10v6" /><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" /></symbol>
      <symbol id="i-tv" viewBox="0 0 24 24"><path d="m17 2l-5 5l-5-5" /><rect width="20" height="15" x="2" y="7" rx="2" /></symbol>
      <symbol id="i-tag" viewBox="0 0 24 24"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></symbol>
      <symbol id="i-tags" viewBox="0 0 24 24"><path d="M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1zM2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193" /><circle cx="10.5" cy="6.5" r=".5" fill="currentColor" /></symbol>
      <symbol id="i-ruler" viewBox="0 0 24 24"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Zm-6.8-2.8l2-2m-5-1l2-2m-5-1l2-2m7 11l2-2" /></symbol>
      <symbol id="i-zap" viewBox="0 0 24 24"><path d="M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 2.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z" /></symbol>
      <symbol id="i-trend" viewBox="0 0 24 24"><path d="M16 7h6v6" /><path d="m22 7l-8.5 8.5l-5-5L2 17" /></symbol>
      <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20a14.5 14.5 0 0 0 0-20M2 12h20" /></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path d="M5 12h14m-7-7v14" /></symbol>
      <symbol id="i-car" viewBox="0 0 24 24"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" /><circle cx="7" cy="17" r="2" /><path d="M9 17h6" /><circle cx="17" cy="17" r="2" /></symbol>
      <symbol id="i-briefcase" viewBox="0 0 24 24"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /><rect width="20" height="14" x="2" y="6" rx="2" /></symbol>
      <symbol id="i-heart" viewBox="0 0 24 24"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676a.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" /></symbol>
      <symbol id="i-landmark" viewBox="0 0 24 24"><path d="M10 18v-7m1.119-8.795a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949zM14 18v-7m4 7v-7M3 22h18M6 18v-7" /></symbol>
      <symbol id="i-scancheck" viewBox="0 0 24 24"><path d="m8 11l2 2l4-4" /><circle cx="11" cy="11" r="8" /><path d="m21 21l-4.3-4.3" /></symbol>
      <symbol id="i-external" viewBox="0 0 24 24"><path d="M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></symbol>

    </svg>
  )
}

/** Icon nét trong sprite. */
export function Ic({ id, className = 'cs-ic', style }: { id: string; className?: string; style?: React.CSSProperties }): JSX.Element {
  return (
    <svg className={className} style={style}>
      <use href={`#${id}`} />
    </svg>
  )
}

/** Cờ quốc gia — chỉ import đúng nước đang dùng để bundle không kéo cả ~250 lá cờ. */
const FLAGS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  US, GB, VN, JP, KR, IN, BR, ID, TH, PH, MX, DE, FR, ES, PT, RU
}

/** Cờ theo mã ISO 2 chữ (hoa). Mã lạ → không vẽ gì, chỉ còn phần chữ bên cạnh. */
export function Flag({ code, style }: { code: string; style?: React.CSSProperties }): JSX.Element | null {
  const F = FLAGS[code.toUpperCase()]
  return F ? <F className="cs-flag" style={style} /> : null
}
