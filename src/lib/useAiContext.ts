import { useEffect, useState } from "react"

export interface AiContextValue {
  text: string | null
  generatedAt: string | null
  loading: boolean
}

// Fetches an AI insight once on mount via the given (30-minute-cached) API
// function. State is only updated after the await, so this is safe to call
// from effects.
export function useAiContext(
  load: () => Promise<{ text: string | null; generated_at: string | null }>
): AiContextValue {
  const [state, setState] = useState<AiContextValue>({
    text: null,
    generatedAt: null,
    loading: true,
  })

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
      .then((value) =>
        setState({
          text: value.text,
          generatedAt: value.generated_at,
          loading: false,
        })
      )
      .catch(() => setState({ text: null, generatedAt: null, loading: false }))
  }, [load])

  return state
}
