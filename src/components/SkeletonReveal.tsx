import type { ReactNode } from "react"
import { useReveal } from "@/lib/useReveal"

// The shared skeleton-to-content reveal wrapper. While loading the
// skeleton owns the flow; when the data lands the two cross-fade in
// the same grid cell - the shape-matched skeleton keeps the heights
// equal, so nothing shifts at the moment of the swap - and the
// skeleton unmounts once its fade completed.
//
// The `loading` flag means "no first content yet": data hooks keep
// the previous content on screen through background refreshes, so a
// refresh never flashes a skeleton over existing content. An error
// is not loading: the honest error treatment fades in like content,
// never a skeleton.
function SkeletonReveal({
  loading,
  skeleton,
  children,
  className,
}: {
  loading: boolean
  skeleton: ReactNode
  children: ReactNode
  className?: string
}) {
  const phase = useReveal(loading)

  if (phase === "skeleton") {
    return (
      <div className={className} aria-busy="true">
        {skeleton}
      </div>
    )
  }

  if (phase === "revealing") {
    return (
      <div className={`grid grid-rows-1 ${className ?? ""}`}>
        {/* The single 1fr row fills the wrapper's full height (the
            grid cell the parent layout gives it), and both layers
            are themselves grids so their child card stretches to
            that cell in both dimensions - exactly as it does as a
            direct grid item before and after. The cross-fade must
            neither collapse the card's height nor shrink its
            width. */}
        <div className="col-start-1 row-start-1 fade-out pointer-events-none grid">
          {skeleton}
        </div>
        <div className="col-start-1 row-start-1 fade-in grid">{children}</div>
      </div>
    )
  }

  return <>{children}</>
}

export default SkeletonReveal
