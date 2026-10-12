import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react"
import { useSearchParams } from "react-router-dom"

// Global Energy/Cost mode for the analytical pages: the primary axis
// switches between kWh and EUR. The choice lives in the URL
// (mode=energy|cost) so navigation and reload keep it; invalid values
// fall back to "energy". The hub (Today) never renders the toggle,
// but the param rides along unchanged.

export type Mode = "energy" | "cost"

interface ModeContextValue {
  mode: Mode
  setMode: (mode: Mode) => void
}

const ModeContext = createContext<ModeContextValue | null>(null)

// The mode part of the current URL as a search string ("?mode=cost"),
// or "" when the URL carries no valid mode param. Links append it so
// navigating between pages keeps the global mode.
// eslint-disable-next-line react/only-export-components
export function useModeSearch(): string {
  const [searchParams] = useSearchParams()
  const raw = searchParams.get("mode")
  return raw === "energy" || raw === "cost" ? `?mode=${raw}` : ""
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get("mode")
  const mode: Mode = raw === "cost" ? "cost" : "energy"

  // Merges into the existing params (period, date) instead of
  // replacing them, so toggling never disturbs the period state.
  const setMode = useCallback(
    (next: Mode) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev)
        params.set("mode", next)
        return params
      })
    },
    [setSearchParams],
  )

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode])

  return (
    <ModeContext.Provider value={value}>{children}</ModeContext.Provider>
  )
}

// eslint-disable-next-line react/only-export-components
export function useMode(): ModeContextValue {
  const value = useContext(ModeContext)
  if (value === null) {
    throw new Error("useMode must be used inside ModeProvider")
  }
  return value
}
