import { useEffect, useState } from "react"
import type { ContextBoxResponse } from "@/lib/api"

export interface AiContextValue {
  text: string | null
  generatedAt: string | null
  error: string | null
  loading: boolean
}

// Window event through which the header refresh button regenerates every
// insight at once; each useAiContext instance re-fetches with force.
export const AI_REFRESH_EVENT = "ai-insights-refresh"

export function triggerAiRefresh() {
  window.dispatchEvent(new Event(AI_REFRESH_EVENT))
}

// Fetches an insight once on mount via the given (30-minute-cached) API
// function, and re-fetches with force when the global refresh event fires.
// State is only updated after the await, so this is safe to call from
// effects.
export function useAiContext(
  load: (force?: boolean) => Promise<{
    text: string | null
    generated_at: string | null
    error?: string | null
  }>
): AiContextValue {
  const [state, setState] = useState<AiContextValue>({
    text: null,
    generatedAt: null,
    error: null,
    loading: true,
  })

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
      .then((value) =>
        setState({
          text: value.text,
          generatedAt: value.generated_at,
          error: value.error ?? null,
          loading: false,
        })
      )
      .catch(() =>
        setState({ text: null, generatedAt: null, error: null, loading: false })
      )
  }, [load])

  useEffect(() => {
    const onRefresh = () => {
      setState((prev) => ({ ...prev, loading: true }))
      void load(true)
        .then((value) =>
          setState({
            text: value.text,
            generatedAt: value.generated_at,
            error: value.error ?? null,
            loading: false,
          })
        )
        // Keep the previous text when a forced refresh fails; the box only
        // clears when the server explicitly returns no text.
        .catch(() => setState((prev) => ({ ...prev, loading: false })))
    }
    window.addEventListener(AI_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(AI_REFRESH_EVENT, onRefresh)
  }, [load])

  return state
}

export interface AiContextSectionsValue {
  // The page endpoint's whole payload, null before the first response
  // or after a failed fetch; the boxes read their sections from it.
  response: ContextBoxResponse | null
  loading: boolean
}

// The section-box variant of useAiContext, with the identical refetch
// policy: one fetch on mount through the given (30-minute-cached) API
// function - re-run when the loader identity changes, e.g. when the
// period anchor moves - and a forced re-fetch when the global refresh
// event fires. The previous payload stays on screen through a refresh
// (the skeleton floor in useReveal applies at the initial mount only),
// and a failed forced refresh keeps the previous payload.
export function useAiContextSections(
  load: (force?: boolean) => Promise<ContextBoxResponse>
): AiContextSectionsValue {
  const [state, setState] = useState<AiContextSectionsValue>({
    response: null,
    loading: true,
  })

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
      .then((value) => setState({ response: value, loading: false }))
      .catch(() => setState({ response: null, loading: false }))
  }, [load])

  useEffect(() => {
    const onRefresh = () => {
      setState((prev) => ({ ...prev, loading: true }))
      void load(true)
        .then((value) => setState({ response: value, loading: false }))
        // Keep the previous payload when a forced refresh fails.
        .catch(() => setState((prev) => ({ ...prev, loading: false })))
    }
    window.addEventListener(AI_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(AI_REFRESH_EVENT, onRefresh)
  }, [load])

  return state
}
