import { SearchPanel } from './SearchPanel'

export function SearchTab(): JSX.Element {
  // Cài đặt (API key, profile check TikTok) nằm ở tab ⚙️ Setting — thiết kế bỏ nút
  // cài đặt khỏi thanh tiêu đề của tab này.
  // overflow-y-auto: mở bộ lọc nâng cao đẩy nội dung xuống quá màn hình thì cuộn được.
  return (
    <div className="flex-1 flex flex-col min-w-0 p-5 cs-tabscroll hv-scroll">
      <div className="flex items-center mb-3 shrink-0">
        <div className="text-[21px] font-bold">🔍 Search Kênh</div>
      </div>

      <SearchPanel />
    </div>
  )
}
