import { Icon } from '../../components/Icon'
import type { AudienceScope, BulkVideoAction, BulkVideoConfig, VideoPrivacy } from '@shared/types'

function Pick<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { v: T; label: string }[]
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={
            'flex-1 h-10 rounded-[10px] text-[13.5px] font-semibold border transition whitespace-nowrap px-2 ' +
            (o.v === value
              ? 'border-[#3a3d6b] bg-[linear-gradient(100deg,rgba(129,140,248,.20),rgba(34,211,238,.10))] text-white'
              : 'border-border bg-surface text-[#c7c8d4] hover:border-[#3a3d6b]')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Một mục quyền riêng tư tài khoản: nhãn, chú thích, rồi các lựa chọn.
 *
 * CẢ BA mục dùng đúng khuôn này — ba ô cạnh nhau mà ba kiểu điều khiển thì mắt
 * phải học lại từng ô.
 */
function Field<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint: string
  value: T
  options: { v: T; label: string }[]
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="flex-1 min-w-0 bg-[#0e0f15] border border-borderSoft rounded-[11px] px-3.5 py-3 flex flex-col">
      <div className="text-[13px] font-semibold">{label}</div>
      <div className="text-[11.5px] text-muted truncate">{hint}</div>
      {/* mt-auto: ba ô cao bằng nhau nên dãy nút của chúng thẳng hàng dù chú
          thích dài ngắn khác nhau. */}
      <div className="mt-auto pt-2.5">
        <Pick<T> value={value} onChange={onChange} options={options} />
      </div>
    </div>
  )
}

export function BulkVideoConfigForm({
  cfg,
  onPatch,
}: {
  cfg: BulkVideoConfig
  onPatch: (p: Partial<BulkVideoConfig>) => void
}): JSX.Element {
  // Template lưu trước khi có phần này thiếu hẳn khoá `account`. TemplateStore
  // đã điền lúc đọc, nhưng đỡ luôn ở đây để form không sập nếu có đường nào khác.
  const acc = cfg.account ?? { privateAccount: 'off' as const, comment: 'everyone' as const, duet: 'everyone' as const }
  const patchAcc = (p: Partial<BulkVideoConfig['account']>): void => onPatch({ account: { ...acc, ...p } })

  const AUDIENCE: { v: AudienceScope; label: string }[] = [
    { v: 'everyone', label: 'Mọi người' },
    { v: 'friends', label: 'Bạn bè' },
  ]

  return (
    <>
      {/* ── Quyền riêng tư TÀI KHOẢN ───────────────────────────────────────
          Cùng ba mục và cùng bố cục với panel ở tab Quản lý hồ sơ, chỉ khác là
          ở đây nó áp cho MỌI hồ sơ được chọn lúc bấm Chạy.

          Không có lựa chọn "giữ nguyên": mỗi lần chạy đều GHI cả ba mục. Phần
          thi hành vẫn bỏ qua mục nào đang trùng giá trị (runAccountPrivacy đọc
          trang trước khi bấm) nên không sinh thao tác thừa trên TikTok. */}
      <div className="text-[12px] uppercase tracking-wide text-muted font-bold mb-2.5">Quyền riêng tư tài khoản</div>
      <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4">
        <div className="flex gap-3 items-stretch">
          <Field<'on' | 'off'>
            label="Tài khoản riêng tư"
            hint="Chỉ người được duyệt mới follow và xem được"
            value={acc.privateAccount}
            onChange={(privateAccount) => patchAcc({ privateAccount })}
            options={[
              { v: 'on', label: 'Bật' },
              { v: 'off', label: 'Tắt' },
            ]}
          />
          <Field<AudienceScope>
            label="Quyền bình luận"
            hint="Bình luận bài đăng của bạn"
            value={acc.comment}
            onChange={(comment) => patchAcc({ comment })}
            options={AUDIENCE}
          />
          <Field<AudienceScope>
            label="Quyền đăng lại"
            hint="Đăng lại nội dung của bạn"
            value={acc.duet}
            onChange={(duet) => patchAcc({ duet })}
            options={AUDIENCE}
          />
        </div>
      </div>

      {/* ── Từng video ──────────────────────────────────────────────────────
          Một khung duy nhất. Bản trước tách "Video" và "Đổi thành" thành hai
          mục có tiêu đề riêng, nhưng "đổi thành gì" chỉ là tham số của lựa chọn
          ngay bên trên — tách ra thì nó trông như một quyết định độc lập, mà
          lại còn treo lơ lửng khi đang chọn Xóa. */}
      <div className="text-[12px] uppercase tracking-wide text-muted font-bold mb-2.5">Video</div>
      <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4">
        <Pick<BulkVideoAction>
          value={cfg.action}
          onChange={(action) => onPatch({ action })}
          options={[
            { v: 'privacy', label: 'Đổi quyền riêng tư' },
            { v: 'delete', label: 'Xóa video' },
          ]}
        />

        {cfg.action === 'privacy' && (
          <div className="mt-3 pt-3 border-t border-borderSoft">
            <div className="text-[12.5px] text-muted mb-2">Đổi toàn bộ video thành</div>
            <Pick<VideoPrivacy>
              value={cfg.privacy}
              onChange={(privacy) => onPatch({ privacy })}
              options={[
                { v: 'public', label: 'Mọi người' },
                { v: 'friends', label: 'Bạn bè' },
                { v: 'private', label: 'Riêng tư' },
              ]}
            />
          </div>
        )}

        {cfg.action === 'delete' && (
          // Xoá qua Template là chạy được hàng loạt nhiều nick trong một cú bấm —
          // nặng tay hơn hẳn nút xoá từng video ở tab Quản lý hồ sơ. Nói rõ mức
          // độ ngay tại chỗ cấu hình, đừng đợi tới lúc bấm Chạy mới hiện.
          <div className="mt-3 px-3.5 py-3 rounded-[10px] border border-[#5a2c33] bg-[rgba(251,113,133,.10)] text-[13px] text-danger leading-relaxed">
            <Icon name="warning" filled size={16} className="inline align-[-3px] mr-1.5" />
            Xóa TOÀN BỘ video của mọi hồ sơ được chọn khi chạy. TikTok cho khôi phục trong 30 ngày qua Trung tâm hoạt
            động &gt; Đã xóa gần đây, sau đó mới mất hẳn.
          </div>
        )}
      </div>
    </>
  )
}
