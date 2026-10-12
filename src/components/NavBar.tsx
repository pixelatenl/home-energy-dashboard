import { Link, NavLink } from "react-router-dom"

const TABS = [
  { to: "/", label: "Today", end: true },
  { to: "/usage", label: "Usage", end: false },
  { to: "/solar", label: "Solar", end: false },
  { to: "/battery", label: "Battery", end: false },
  { to: "/appliances", label: "Appliances", end: false },
  { to: "/heat", label: "Heat", end: false },
]

// Primary navigation: a segmented control in the same idiom as the
// usage page's range selector, with the active tab lifted onto the
// card background and marked with aria-current (NavLink sets it on
// the active route). Architecture and API debug sit to the right as
// small muted links.
function NavBar() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <nav
        aria-label="Main navigation"
        className="inline-flex rounded-lg border bg-muted p-1"
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none ${
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className="flex items-center gap-4 text-sm">
        <Link
          to="/architecture"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Architecture
        </Link>
        <Link
          to="/debug"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          API debug
        </Link>
      </div>
    </div>
  )
}

export default NavBar
