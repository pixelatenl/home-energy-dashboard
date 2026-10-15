import type { TimeOfDayPhase } from "@/lib/timeOfDay"

// Time-of-day sky for the live energy flow widget: a full-bleed abstract
// background of CSS gradients with the sun by day and the moon, stars
// and drifting clouds, following the browser's local clock. Two phases
// only, day and night; sky colors follow the "CSS Animation: Time of
// Day" sky layers (codepen.io/oliviale/pen/ELPvLM); only its colors and
// celestial elements are taken, no scene props. All continuous
// animation is transform/opacity only. The phase logic lives in
// src/lib/timeOfDay.ts.

// One sky per phase: a deep daytime blue (light horizon, darker
// zenith - reads against the dark glass theme while staying
// unmistakably day, with the sun carrying the daylight), deep blue to
// near-black at night.
const PHASE_GRADIENTS: Record<TimeOfDayPhase, string> = {
  day: "linear-gradient(to top, #9dc2de 0%, #5d8db5 45%, #2c5c88 100%)",
  night: "linear-gradient(to top, #17377f 0%, #0c1c46 45%, #050b1c 100%)",
}

// The sun: a solid disc with blurred edges only (the blur filter on a
// uniformly filled circle softens just the rim), as in the reference.
const SUN_SIZE = 56
const SUN_EDGE_BLUR = 5

const CLOUDS = [
  { top: "18%", width: 210, height: 56, duration: 170, delay: 0 },
  { top: "30%", width: 140, height: 40, duration: 230, delay: -90 },
  { top: "11%", width: 110, height: 32, duration: 200, delay: -150 },
]

// Fixed star positions in the upper half, so re-renders never reshuffle
// the sky.
const STARS = [
  { left: "6%", top: "8%", size: 2, delay: 0 },
  { left: "14%", top: "22%", size: 3, delay: 1.2 },
  { left: "23%", top: "6%", size: 2, delay: 2.1 },
  { left: "31%", top: "34%", size: 2, delay: 0.6 },
  { left: "38%", top: "15%", size: 3, delay: 3.3 },
  { left: "46%", top: "41%", size: 2, delay: 1.8 },
  { left: "52%", top: "9%", size: 2, delay: 0.9 },
  { left: "59%", top: "27%", size: 3, delay: 2.7 },
  { left: "66%", top: "5%", size: 2, delay: 1.5 },
  { left: "73%", top: "36%", size: 2, delay: 3.9 },
  { left: "81%", top: "12%", size: 3, delay: 0.3 },
  { left: "88%", top: "29%", size: 2, delay: 2.4 },
  { left: "94%", top: "7%", size: 2, delay: 1.1 },
  { left: "10%", top: "44%", size: 2, delay: 3.6 },
  { left: "27%", top: "48%", size: 2, delay: 0.7 },
  { left: "43%", top: "5%", size: 2, delay: 2.9 },
  { left: "56%", top: "47%", size: 2, delay: 1.6 },
  { left: "70%", top: "43%", size: 2, delay: 3.1 },
  { left: "86%", top: "46%", size: 2, delay: 0.5 },
  { left: "19%", top: "38%", size: 2, delay: 2.2 },
]

// The background proper: absolutely positioned inside the widget card,
// behind all content (the caller keeps the content at a higher
// z-index). The two gradient layers cross-fade on phase changes; the
// sun rides its arc by day, low at the horizon at sunrise/sunset and
// high at midday; clouds drift by day; the moon and twinkling stars
// appear at night.
function TimeOfDayBackground({
  phase,
  sunProgress,
}: {
  phase: TimeOfDayPhase
  sunProgress: number | null
}) {
  // Arc across the widget: near the horizon at the ends, high at noon.
  const sunLeft = sunProgress !== null ? 8 + 84 * sunProgress : 50
  const sunTop =
    sunProgress !== null
      ? 78 - 60 * Math.sin(Math.PI * sunProgress)
      : 78
  const daySky = phase === "day"

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      {(Object.keys(PHASE_GRADIENTS) as TimeOfDayPhase[]).map((key) => (
        <div
          key={key}
          className="absolute inset-0 transition-opacity duration-[2500ms]"
          style={{
            backgroundImage: PHASE_GRADIENTS[key],
            opacity: key === phase ? 1 : 0,
          }}
        />
      ))}
      <div
        className="absolute rounded-full transition-[left,top,opacity] duration-[2500ms] ease-out"
        style={{
          left: `${sunLeft}%`,
          top: `${sunTop}%`,
          width: SUN_SIZE,
          height: SUN_SIZE,
          transform: "translate(-50%, -50%)",
          opacity: daySky ? 1 : 0,
          background: "#f9db5a",
          filter: `blur(${SUN_EDGE_BLUR}px)`,
        }}
      />
      {CLOUDS.map((cloud, index) => (
        <div
          key={index}
          className="cloud-drift absolute rounded-full transition-opacity duration-[2500ms]"
          style={{
            top: cloud.top,
            left: 0,
            width: cloud.width,
            height: cloud.height,
            background: "rgba(255, 255, 255, 0.9)",
            filter: "blur(9px)",
            opacity: daySky ? 0.4 : 0,
            animationDuration: `${cloud.duration}s`,
            animationDelay: `${cloud.delay}s`,
          }}
        />
      ))}
      <div
        className="absolute transition-opacity duration-[2500ms]"
        style={{
          left: "74%",
          top: "14%",
          width: 42,
          height: 42,
          opacity: daySky ? 0 : 0.9,
        }}
      >
        <div
          className="size-full rounded-full bg-white"
          style={{
            boxShadow: "inset -9px -5px 0 rgba(22, 55, 127, 0.4)",
          }}
        />
      </div>
      {STARS.map((star, index) => (
        <div
          key={index}
          className={`absolute rounded-full bg-white transition-opacity duration-[2500ms] ${
            daySky ? "" : "star-twinkle"
          }`}
          style={{
            left: star.left,
            top: star.top,
            width: star.size,
            height: star.size,
            opacity: daySky ? 0 : 1,
            animationDelay: `${star.delay}s`,
          }}
        />
      ))}
    </div>
  )
}

export default TimeOfDayBackground
