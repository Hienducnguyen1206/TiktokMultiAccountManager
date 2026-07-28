/** Renders a real flag image (works on Windows, unlike emoji flags). */
export function Flag({ code, w = 24 }: { code: string | null | undefined; w?: number }): JSX.Element {
  const h = Math.round((w * 3) / 4)
  if (!code) {
    return (
      <span
        className="inline-block rounded-[2px] bg-border align-[-3px] mr-1.5"
        style={{ width: w, height: h }}
      />
    )
  }
  return (
    <img
      src={`https://flagcdn.com/${w}x${h}/${code}.png`}
      width={w}
      height={h}
      className="inline-block rounded-[2px] align-[-3px] mr-1.5"
      alt={code}
    />
  )
}
