import { useEffect, useRef, useState } from "react"

// The shared loading reveal: one implementation of the skeleton's
// minimum display time and the skeleton-to-content cross-fade,
// consumed by every widget through SkeletonReveal instead of each
// widget timing its own transition.
//
// Roland's preference, encoded here: a smooth experience over a fast
// one. A skeleton shows for at least the floor before the fade
// starts, so a fast API response reads as one calm fade rather than
// a flash; the fade itself is a short cross-fade on both sides.
//
// The floor applies only to the initial mount of a widget. The data
// hooks keep the previous content on screen while background
// refreshes revalidate, so `loading` never flips back to true once
// content exists - and the phase below only ever moves forward, so
// a refresh or a period switch can never re-trigger a skeleton over
// existing content.

// The minimum time a skeleton stays fully visible before the
// cross-fade starts. Tuned for calm over speed: the APIs usually
// answer faster than this, and a brief hold makes the reveal read
// as one unhurried transition instead of a flash.
export const REVEAL_FLOOR_MS = 650
// The cross-fade duration, applied to both sides: content fades in
// while the skeleton fades out.
export const REVEAL_FADE_MS = 300

export type RevealPhase = "skeleton" | "revealing" | "done"

export function useReveal(loading: boolean): RevealPhase {
  // Content already present on the first render (a cached response)
  // never shows a skeleton at all.
  const [phase, setPhase] = useState<RevealPhase>(
    loading ? "skeleton" : "done"
  )
  // eslint-disable-next-line react/purity
  const mountedAt = useRef(Date.now())

  useEffect(() => {
    if (loading || phase !== "skeleton") {
      return
    }
    // Hold the skeleton for the floor measured from the widget's
    // mount, not from the moment the data landed.
    const wait = Math.max(
      0,
      REVEAL_FLOOR_MS - (Date.now() - mountedAt.current)
    )
    const id = setTimeout(() => setPhase("revealing"), wait)
    return () => clearTimeout(id)
  }, [loading, phase])

  useEffect(() => {
    if (phase !== "revealing") {
      return
    }
    // The skeleton unmounts only after its fade completed.
    const id = setTimeout(() => setPhase("done"), REVEAL_FADE_MS + 60)
    return () => clearTimeout(id)
  }, [phase])

  return phase
}
