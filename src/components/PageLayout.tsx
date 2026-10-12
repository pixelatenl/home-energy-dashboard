import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import NavBar from "@/components/NavBar"
import { useModeSearch } from "@/lib/mode"

// Shared page shell: the page header (title, subtitle, actions), the
// tab row with a per-page toolbar on its right, the content area and
// the site footer with the secondary links. Pages pass their content
// as children; the header and toolbar slots keep each page's own
// controls (insight pill, range selector, debug buttons).
function PageLayout({
  title,
  subtitle,
  actions,
  toolbar,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  toolbar?: ReactNode
  children: ReactNode
}) {
  // Footer links carry the mode param so the global mode survives
  // navigation through the utility pages too.
  const modeSearch = useModeSearch()
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            {subtitle != null &&
              (typeof subtitle === "string" ? (
                <p className="text-sm text-muted-foreground">{subtitle}</p>
              ) : (
                subtitle
              ))}
          </div>
          {actions != null && (
            <div className="flex items-center gap-3">{actions}</div>
          )}
        </div>
      </header>

      <div className="px-6 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <NavBar />
          {toolbar != null && toolbar}
        </div>
      </div>

      <main className="space-y-6 px-6 pt-4 pb-8">{children}</main>

      <footer className="border-t">
        <div className="flex flex-wrap items-center gap-4 px-6 py-4 text-sm">
          <Link
            to={`/architecture${modeSearch}`}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Architecture
          </Link>
          <Link
            to={`/debug${modeSearch}`}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            API debug
          </Link>
        </div>
      </footer>
    </div>
  )
}

export default PageLayout
