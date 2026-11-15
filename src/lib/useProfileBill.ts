import { useCallback, useEffect, useRef, useState } from "react"
import { fetchProfileBill, type ProfileBillData } from "@/lib/api"
import { useDataRefreshListener } from "@/lib/useDataRefresh"

// Fetches the estimated bill for one month (YYYY-MM) and joins the
// 5-minute refresh cycle. A response that resolves after a month
// switch is discarded, so a slow previous month can never overwrite
// the selected one.
export function useProfileBill(month: string): {
  data: ProfileBillData | null
  status: "loading" | "ok" | "error"
} {
  const [data, setData] = useState<ProfileBillData | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    try {
      const value = await fetchProfileBill(month)
      if (id === requestId.current) {
        setData(value)
        setStatus("ok")
      }
    } catch {
      if (id === requestId.current) {
        setStatus("error")
      }
    }
  }, [month])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  useEffect(() => {
    const id = setInterval(() => void load(), 5 * 60_000)
    return () => clearInterval(id)
  }, [load])

  // Re-fetch immediately when the header refresh button fires.
  useDataRefreshListener(load)

  return { data, status }
}
