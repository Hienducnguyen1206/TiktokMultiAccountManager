# Profile Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay modal cài đặt profile bằng panel bung inline ngay dưới hàng, bố cục ba cột, toàn bộ control tự vẽ.

**Architecture:** Thêm một component `Segmented` tự vẽ, tách nội dung cài đặt ra `ProfilePanel.tsx`, và cho `ProfileTab` render panel đó dưới hàng đang mở thay vì mở `ProfileSettingsDialog`. Tái dùng `Select` và `Toggle` đã có sẵn từ nhánh channel-search.

**Tech Stack:** React 18, TypeScript, Tailwind, electron-vite.

**Spec:** `docs/superpowers/specs/2026-08-02-profile-tab-redesign-design.md`
**Mockup:** `mockups/profile.html`

## Global Constraints

- Chuỗi hiển thị cho người dùng viết tiếng Việt; tên biến, hàm, comment viết tiếng Anh.
- **Không dùng control mặc định của trình duyệt ở bất kỳ đâu trong tính năng profile.** Không `<select>`, không `<input type="checkbox">`, không `<input type="range">`. Dropdown dùng `Select` (`src/renderer/src/components/Select.tsx`), bật/tắt dùng `Toggle`, nhiều lựa chọn ngắn dùng `Segmented` (Task 1).
- Bảng màu lấy từ `tailwind.config.js`: `bg #0a0b10`, `surface #14151c`, `card #0b0c12`, `border #23242e`, `borderSoft #1b1c25`, `muted #7c7d8c`, `text #e7e7ee`, `subtle #9a9bab`, `accent #6366f1`, `accent2 #22d3ee`, `ok #34d399`, `danger #fb7185`, `warn #fb923c`.
- Code phải khớp mockup `mockups/profile.html`, không tự bịa thêm thành phần.
- `npx tsc --noEmit` và `npm run build` phải sạch sau mỗi task.
- Không đụng `src/main/**`. Đây là task thuần giao diện.

## Ngoài phạm vi plan này

Mockup có bốn nhóm trường chưa tồn tại trong kiểu `Fingerprint`: **media devices**, **cổng chặn quét**, **Do Not Track**, **vị trí (auto / nhập tay)**. Thêm chúng đòi hỏi mở rộng `Fingerprint`, `toShardOverrides()`, và phải **xác minh bằng thực nghiệm** tên khoá thật trong config của ShardX — dự án này đã ba lần đoán sai tên khoá SDK (`unmasked_vendor`, `cfg.id`, `startsWith('Mac')`). Làm ở plan sau, bắt đầu bằng bước đọc một file template thật rồi mới viết code.

Panel ở plan này hiển thị đúng những trường đang có: tên, nhóm, cảnh báo, hệ điều hành, thiết bị/GPU, User-Agent, CPU/RAM, màn hình, proxy, múi giờ, ngôn ngữ, nhiễu 6 vector, WebRTC, TikTok, trang chủ, ghi chú.

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `src/renderer/src/components/Segmented.tsx` *(tạo)* | Control nhiều lựa chọn ngắn, tự vẽ. Dùng cho Hệ điều hành, Thật/Nhiễu, Cảnh báo 0–5. |
| `src/renderer/src/features/profile/ProfilePanel.tsx` *(tạo)* | Nội dung cài đặt, bố cục ba cột. Nhận `profile`, `groups`, `proxies`, gọi `onSaved`/`onClose`. |
| `src/renderer/src/features/profile/ProfileTab.tsx` *(sửa)* | Cột bảng mới + trạng thái hàng đang mở + render `ProfilePanel` trong `<tr>` `colSpan`. |
| `src/renderer/src/features/profile/ProfileSettingsDialog.tsx` *(xoá ở Task 4)* | Modal cũ, thay hẳn. |

---

### Task 1: Component `Segmented`

**Files:**
- Create: `src/renderer/src/components/Segmented.tsx`

**Interfaces:**
- Consumes: không có.
- Produces: `Segmented({ value, options, onChange, tone })` — `value: string`, `options: { value: string; label: string }[]`, `onChange: (v: string) => void`, `tone?: 'accent' | 'soft'`.

- [ ] **Step 1: Viết component**

```tsx
export interface SegmentedOption {
  value: string
  label: string
}

/**
 * Short multiple-choice control drawn in-app — the project never renders a
 * native <select> or radio, so the popup/knob always matches the theme.
 * `tone='accent'` fills the active pill with the brand gradient (primary
 * choices); `tone='soft'` uses a flat panel so a row of several controls does
 * not turn into a wall of gradient.
 */
export function Segmented({
  value,
  options,
  onChange,
  tone = 'accent',
  size = 'md'
}: {
  value: string
  options: SegmentedOption[]
  onChange: (v: string) => void
  tone?: 'accent' | 'soft'
  size?: 'sm' | 'md'
}): JSX.Element {
  return (
    <div className="flex bg-[#101117] border border-border rounded-[9px] p-[3px] gap-[3px]">
      {options.map((o) => {
        const on = o.value === value
        const base =
          size === 'sm'
            ? 'flex-1 text-center rounded-[7px] px-1 py-[5px] text-[12px] cursor-pointer whitespace-nowrap'
            : 'flex-1 text-center rounded-[7px] px-1 py-1.5 text-[13px] cursor-pointer whitespace-nowrap'
        const state = !on
          ? 'text-subtle'
          : tone === 'accent'
            ? 'accent-grad text-[#0a0b10] font-bold'
            : 'bg-[#1e2030] text-white border border-[#3a3d6b] font-bold'
        return (
          <div key={o.value} className={`${base} ${state}`} onClick={() => onChange(o.value)}>
            {o.label}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Kiểm biên dịch**

```bash
npx tsc --noEmit
```

Kỳ vọng: 0 lỗi. Component chưa được dùng ở đâu nên rollup sẽ tree-shake — điều đó bình thường.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Segmented.tsx
git commit -m "feat: them component Segmented tu ve"
```

---

### Task 2: `ProfilePanel` — nội dung cài đặt ba cột

**Files:**
- Create: `src/renderer/src/features/profile/ProfilePanel.tsx`
- Reference: `src/renderer/src/features/profile/ProfileSettingsDialog.tsx` (nguồn logic lưu/xoá, chép sang rồi bỏ phần khung modal)

**Interfaces:**
- Consumes: `Segmented` (Task 1), `Select` từ `../../components/Select`, `GroupSelect` từ `./GroupSelect`, `ConfirmDialog`, `showToast`.
- Produces: `ProfilePanel({ profile, groups, proxies, onSaved, onClose })` — `onSaved: () => void` gọi sau khi lưu thành công, `onClose: () => void` khi bấm Hủy.

- [ ] **Step 1: Đọc dialog cũ để lấy nguyên logic lưu/xoá**

```bash
sed -n '1,120p' src/renderer/src/features/profile/ProfileSettingsDialog.tsx
```

Ghi lại: cách nó gọi `window.hnv.profiles.update(...)`, `window.hnv.profiles.remove(...)`, hình dạng state `fp`/`setFp`, và danh sách proxy nạp từ đâu. Task này tái dùng đúng các lời gọi đó, không phát minh API mới.

- [ ] **Step 2: Viết `ProfilePanel.tsx`**

Bố cục bắt buộc, khớp `mockups/profile.html`: một `div` bọc ngoài `p-[18px_20px_16px] border-t border-borderSoft`, bên trong là `grid grid-cols-3 gap-[26px]`, và cuối là hàng nút `flex justify-end gap-2.5 px-5 py-4 border-t border-borderSoft` với nút Xoá đẩy sang trái bằng `mr-auto`.

Tiêu đề nhóm dùng đúng kiểu của mockup:

```tsx
function Grp({ children, late }: { children: React.ReactNode; late?: boolean }): JSX.Element {
  return (
    <div
      className={`text-[11.5px] uppercase tracking-[.06em] font-bold text-[#818cf8] mb-3 flex items-center gap-[7px] ${late ? 'mt-[22px]' : ''}`}
    >
      <span className="text-[9px]">◆</span>
      {children}
    </div>
  )
}
```

Ba cột đúng thứ tự mockup:

- **Cột 1 — Danh tính:** Tên profile (`input`), Nhóm (`GroupSelect`) + Cảnh báo (`Segmented` 0–5, `tone='soft'`, `size='sm'`), Hệ điều hành (`Segmented` macOS/Windows/Linux — **chỉ đọc**, xem ghi chú dưới), Thiết bị / GPU (chỉ đọc), User-Agent (chỉ đọc), CPU cores / RAM (chỉ đọc), Màn hình (chỉ đọc), Proxy (`Select`).
- **Cột 2 — Khu vực + Nhiễu:** Múi giờ (`Select`: `auto` + vài IANA + cho nhập tay), Ngôn ngữ (`Select`: `auto` + `vi-VN` + `en-US`), rồi nhóm Nhiễu với 6 `Segmented` Thật/Nhiễu (`tone='soft'`, `size='sm'`) cho `canvas`, `webgl`, `audio`, `client_rects`, `sensors`, `fonts`.
- **Cột 3 — Riêng tư + TikTok:** WebRTC (`Select` 3 lựa chọn), rồi nhóm TikTok với Tài khoản, Mật khẩu, Mã 2FA, Trang chủ, và Ghi chú (`textarea`).

**Hệ điều hành, CPU/RAM, Màn hình, Thiết bị, User-Agent phải là chỉ đọc** (`div` mờ `opacity-70`), không phải control. Lý do đã ghi trong code hiện tại: ShardX sở hữu những giá trị này, cho sửa tay là UI nói dối. Mockup vẽ Hệ điều hành thành `Segmented` bấm được — **mockup sai ở điểm này, code đúng hơn**; giữ chỉ-đọc và ghi chú lý do bằng comment tiếng Anh.

Nhiễu ánh xạ hai chiều với `fp.noise: NoiseVector[]`:

```tsx
const VECTORS: { key: NoiseVector; label: string }[] = [
  { key: 'canvas', label: 'Canvas' },
  { key: 'webgl', label: 'WebGL' },
  { key: 'audio', label: 'Audio' },
  { key: 'client_rects', label: 'Client rects' },
  { key: 'sensors', label: 'Cảm biến' },
  { key: 'fonts', label: 'Font' }
]

function toggleNoise(cur: NoiseVector[], v: NoiseVector, on: boolean): NoiseVector[] {
  const next = cur.filter((x) => x !== v)
  return on ? [...next, v] : next
}
```

- [ ] **Step 3: Kiểm không lọt control mặc định**

```bash
grep -nE "<select|<input[^>]*type=[\"']checkbox|<input[^>]*type=[\"']range" src/renderer/src/features/profile/ProfilePanel.tsx || echo "sach"
```

Kỳ vọng: in `sach`. Có kết quả nào là vi phạm ràng buộc toàn cục.

- [ ] **Step 4: Kiểm biên dịch**

```bash
npx tsc --noEmit && npm run build
```

Kỳ vọng: cả hai sạch.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/profile/ProfilePanel.tsx
git commit -m "feat: ProfilePanel bo cuc ba cot, control tu ve"
```

---

### Task 3: `ProfileTab` — bảng mới và bung inline

**Files:**
- Modify: `src/renderer/src/features/profile/ProfileTab.tsx`

**Interfaces:**
- Consumes: `ProfilePanel` (Task 2).
- Produces: không có API mới.

- [ ] **Step 1: Thêm trạng thái hàng đang mở**

Thay state `editing` (đang giữ `Profile | null` để mở modal) bằng:

```tsx
const [openId, setOpenId] = useState<string | null>(null)
```

- [ ] **Step 2: Sửa cột bảng**

Theo mockup: thêm cột checkbox đầu dòng (dùng ô vuông tự vẽ, **không** `<input type="checkbox">`), bỏ cột `#` và cột `Cài đặt`, đưa nút ⚙ vào cụm thao tác bên phải, và thêm id ngắn 8 ký tự dưới tên profile:

```tsx
<td className="px-3 py-3">
  <div className="font-bold">{p.name}</div>
  <div className="text-[11px] text-muted font-mono mt-0.5">{p.id.slice(0, 8)}</div>
</td>
```

Ô vuông tự vẽ:

```tsx
function Cb({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <span
      onClick={onClick}
      className={`w-4 h-4 rounded-[5px] border-[1.5px] inline-block cursor-pointer relative ${
        on ? 'accent-grad border-transparent' : 'border-[#3b3d4f] bg-[#0e0f15]'
      }`}
    >
      {on && (
        <span className="absolute left-[4.5px] top-[1.5px] w-1 h-2 border-r-2 border-b-2 border-[#0a0b10] rotate-[42deg]" />
      )}
    </span>
  )
}
```

Cột checkbox ở plan này **chỉ dựng giao diện, chưa nối thao tác hàng loạt** — đó là việc riêng, ghi rõ bằng comment.

- [ ] **Step 3: Render panel dưới hàng đang mở**

Trong `tbody`, sau mỗi `<tr>` của profile:

```tsx
{openId === p.id && (
  <tr>
    <td colSpan={COL_COUNT} className="p-0 bg-[#0d0e14] rounded-b-[10px]">
      <ProfilePanel
        profile={p}
        groups={groups}
        onSaved={() => {
          setOpenId(null)
          onReload()
        }}
        onClose={() => setOpenId(null)}
      />
    </td>
  </tr>
)}
```

`COL_COUNT` phải khớp đúng số `<th>` trong `thead` — khai một hằng số ở đầu file và dùng cho cả header lẫn `colSpan` để hai chỗ không lệch nhau về sau.

Hàng đang mở đổi nền và bỏ bo góc dưới để nối liền panel: thêm class `bg-[#12131b]` và `rounded-b-none` cho `<tr>` khi `openId === p.id`.

- [ ] **Step 4: Nút ⚙ bật/tắt panel**

```tsx
<div className="w-8 h-8 rounded-lg border border-border bg-surface flex items-center justify-center cursor-pointer"
     onClick={() => setOpenId(openId === p.id ? null : p.id)}>⚙</div>
```

- [ ] **Step 5: Kiểm biên dịch và không còn control mặc định**

```bash
npx tsc --noEmit && npm run build
```

```bash
grep -nE "<select|<input[^>]*type=[\"']checkbox" src/renderer/src/features/profile/ProfileTab.tsx || echo "sach"
```

Kỳ vọng: build sạch, grep in `sach`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/features/profile/ProfileTab.tsx
git commit -m "feat: bang profile moi, cai dat bung inline duoi hang"
```

---

### Task 4: Bỏ modal cũ và soát toàn tính năng

**Files:**
- Delete: `src/renderer/src/features/profile/ProfileSettingsDialog.tsx`
- Modify: file nào còn import nó.

**Interfaces:**
- Consumes: toàn bộ Task 1–3.
- Produces: không có.

- [ ] **Step 1: Tìm nơi còn tham chiếu**

```bash
grep -rn "ProfileSettingsDialog" src/
```

- [ ] **Step 2: Xoá import và file**

```bash
git rm src/renderer/src/features/profile/ProfileSettingsDialog.tsx
```

Xoá dòng import tương ứng trong `ProfileTab.tsx`.

- [ ] **Step 3: Soát toàn bộ tính năng profile không còn control mặc định**

```bash
grep -rnE "<select|<input[^>]*type=[\"'](checkbox|range)" src/renderer/src/features/profile/ || echo "sach"
```

Kỳ vọng: in `sach`.

- [ ] **Step 4: Kiểm biên dịch**

```bash
npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: bo ProfileSettingsDialog, cai dat da chuyen sang panel inline"
```

---

## Kiểm chứng cần người thật

Dự án không có test framework và đây là thay đổi thuần giao diện, nên phần lớn phải nhìn bằng mắt. Sau Task 4, chạy `npm run dev` rồi kiểm:

1. Bấm ⚙ trên một hàng — panel bung ra ngay dưới đúng hàng đó, nền nối liền, không đè lên màn hình.
2. Bấm ⚙ hàng khác — hàng cũ đóng, hàng mới mở (chỉ một panel mở tại một thời điểm).
3. Mọi dropdown xổ ra phải cùng theme, **không** phải hộp trắng của Windows.
4. Đổi Múi giờ hoặc Ngôn ngữ, bấm Lưu, mở lại — giá trị giữ đúng.
5. Bật một vector nhiễu, Lưu, mở lại — vector đó vẫn bật.
6. Bấm Hủy — panel đóng, thay đổi chưa lưu bị bỏ.
7. Xoá profile từ panel — hỏi xác nhận rồi mới xoá.
8. Bảng còn đủ các cột nghiệp vụ: Nhóm, Quốc gia/IP, Trạng thái, Đã login, Cảnh báo, Lần cuối.
