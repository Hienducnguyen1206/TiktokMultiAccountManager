/**
 * Chạy `worker` trên từng phần tử, tối đa `limit` cái cùng lúc.
 *
 * Cùng khuôn với pha đọc số dư trong AnalyticsService (hàng đợi + shift + đúng
 * `limit` luồng chạy song song): luồng nào xong việc thì tự nhặt phần tử kế
 * tiếp, nên một hồ sơ chậm không giữ chỗ của cả nhóm — khác hẳn kiểu chia lô
 * cứng rồi chờ cả lô.
 *
 * Thứ tự KHÔNG bảo toàn và cũng không cần: chỗ dùng chỉ đếm thành công/thất bại.
 * `worker` phải tự nuốt lỗi của nó — một lỗi thoát ra sẽ giết cả luồng đó và bỏ
 * lại phần hàng đợi chưa ai nhặt.
 */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const lanes = Math.max(1, Math.min(limit, queue.length))
  if (queue.length === 0) return
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (;;) {
        const item = queue.shift()
        if (item === undefined) break
        await worker(item)
      }
    })
  )
}
