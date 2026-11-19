import { NavLink } from "react-router-dom"
import { useModeSearch } from "@/lib/mode"

// The Profile entry point: a typographic avatar, fixed at 48 by 48
// pixels, rounded at the widget radius (rounded-xl), with centered
// bold initials in the body font. The initials are hardcoded for now;
// a future Settings section can feed them. It links straight to
// /profile (no dropdown in v1) and carries the mode param like every
// other nav link. On /profile it takes the tab bar's active lift; on
// every other route the quiet card surface with the shared elevation
// token, readable in both themes. Focus ring matches the button
// idiom.
function AvatarLink() {
  // Links carry the mode param so the global mode survives navigation.
  const modeSearch = useModeSearch()
  return (
    <NavLink
      to={`/profile${modeSearch}`}
      aria-label="Profile"
      className={({ isActive }) =>
        `flex h-12 w-12 items-center justify-center rounded-xl border border-transparent text-sm font-bold transition focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${
          isActive
            ? "bg-white/20 text-chip-foreground shadow-card"
            : "bg-card text-muted-foreground shadow-card hover:bg-card-hover"
        }`
      }
    >
      RP
    </NavLink>
  )
}

export default AvatarLink
