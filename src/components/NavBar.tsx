import { NavLink } from "react-router-dom"
import { useModeSearch } from "@/lib/mode"

const TABS = [
  { to: "/", label: "Today", end: true },
  { to: "/usage", label: "Usage", end: false },
  { to: "/solar", label: "Solar", end: false },
  { to: "/battery", label: "Battery", end: false },
  { to: "/heat", label: "Heat", end: false },
]

// Primary navigation: a segmented control in the same idiom as the
// usage page's range selector, with the active tab lifted onto the
// card background and marked with aria-current (NavLink sets it on
// the active route). Rendered by PageLayout on the tab row, left of
// any per-page toolbar.
function NavBar() {
  // Links carry the mode param so the global mode survives tab
  // navigation.
  const modeSearch = useModeSearch()
  return (
    <nav
      aria-label="Main navigation"
      className="inline-flex rounded-md border p-1"
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={`${tab.to}${modeSearch}`}
          end={tab.end}
          className={({ isActive }) =>
            `rounded-md px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none ${
              isActive
                ? "bg-white/20 text-chip-foreground shadow-card backdrop-blur-sm"
                : "text-muted-foreground hover:text-foreground"
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default NavBar
