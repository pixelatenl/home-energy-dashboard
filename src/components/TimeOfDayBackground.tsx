import type { TimeOfDayPhase } from "@/lib/timeOfDay"

// Time-of-day sky for the live energy flow widget: a full-bleed abstract
// background of CSS gradients with a sun, moon, stars and drifting
// clouds. Sky colors follow the "CSS Animation: Time of Day" sky layers
// (codepen.io/oliviale/pen/ELPvLM); only its colors and celestial
// elements are taken, no scene props. All continuous animation is
// transform/opacity only. The phase logic lives in
// src/lib/timeOfDay.ts.

// One multi-stop sky per phase; light at the horizon except night and
// dusk, which darken toward the top.
const PHASE_GRADIENTS: Record<TimeOfDayPhase, string> = {
  night:
    "linear-gradient(to top, #17377f 0%, #0c1c46 45%, #050b1c 100%)",
  sunrise:
    "linear-gradient(to top, #ffbe1d 0%, #ffd26a 16%, #ffd4fe 38%, " +
    "#b3efff 100%)",
  day: "linear-gradient(to top, #d9f4ff 0%, #b3efff 45%, #73addf 100%)",
  sunset:
    "linear-gradient(to top, #ffbe1d 0%, #ffcc33 22%, #ffd4fe 48%, " +
    "#53346d 100%)",
  dusk: "linear-gradient(to top, #870000 0%, #53346d 40%, #221546 100%)",
}

// The sun, soft-glowed as in the reference: a radial gradient from the
// bright disc out through translucent warm rings.
const SUN_SIZE = 84

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
// z-index). Gradient layers cross-fade on phase changes; the sun rides
// its arc low at sunrise/sunset and high at midday; clouds drift only by
// day; the moon and twinkling stars appear at night.
function TimeOfDayBackground({
  phase,
  sunProgress,
}: {
  phase: TimeOfDayPhase
  sunProgress: number | null
}) {
  const sunVisible =
    sunProgress !== null && phase !== "night" && phase !== "dusk"
  // Arc across the widget: near the horizon at the ends, high at noon.
  const sunLeft = sunProgress !== null ? 8 + 84 * sunProgress : 50
  const sunTop =
    sunProgress !== null
      ? 78 - 60 * Math.sin(Math.PI * sunProgress)
      : 78
  const nightSky = phase === "night"
  const cloudsVisible = phase === "day"

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
          opacity: sunVisible ? 1 : 0,
          background:
            "radial-gradient(circle, #f9db5a 0%, rgba(255, 235, 222, " +
            "0.55) 34%, rgba(255, 236, 220, 0.22) 55%, rgba(255, 236, " +
            "220, 0) 72%)",
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
            filter: "blur(14px)",
            opacity: cloudsVisible ? 0.4 : 0,
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
          opacity: nightSky ? 0.9 : 0,
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
            nightSky ? "star-twinkle" : ""
          }`}
          style={{
            left: star.left,
            top: star.top,
            width: star.size,
            height: star.size,
            opacity: nightSky ? 1 : 0,
            animationDelay: `${star.delay}s`,
          }}
        />
      ))}
    </div>
  )
}

export default TimeOfDayBackground
