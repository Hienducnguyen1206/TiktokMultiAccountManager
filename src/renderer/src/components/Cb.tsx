// Self-drawn checkbox square, matches mockups/profile.html `.cb` / `.cb.on`.
// A pure presentation component — it doesn't own the selection logic.
//
// Hand-drawn rather than <input type="checkbox"> on purpose: the native control
// is painted by the browser and cannot be made to match the app's theme.
export function Cb({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <span
      onClick={onClick}
      className={`w-4 h-4 rounded-[5px] border-[1.5px] inline-block cursor-pointer relative shrink-0 ${
        on ? 'accent-grad border-transparent' : 'border-[#3b3d4f] bg-[#0e0f15]'
      }`}
    >
      {on && (
        <span className="absolute left-[4.5px] top-[1.5px] w-1 h-2 border-r-2 border-b-2 border-[#0a0b10] rotate-[42deg]" />
      )}
    </span>
  )
}
