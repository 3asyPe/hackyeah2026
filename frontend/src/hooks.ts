import { useCallback, useEffect, useRef, useState } from 'react'

export interface PollState<T> {
  data: T | null
  error: unknown
  loading: boolean
  refresh: () => void
}

/**
 * Fetches `fn` immediately and then every `interval` ms (null = no polling).
 * `key` changes reset the data. Requests never overlap.
 */
export function usePoll<T>(fn: () => Promise<T>, interval: number | null, key: string = ''): PollState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const intervalRef = useRef(interval)
  intervalRef.current = interval
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setData(null)
    setError(null)
    setLoading(true)
  }, [key])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      try {
        const v = await fnRef.current()
        if (cancelled) return
        setData(v)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setError(e)
      } finally {
        if (!cancelled) {
          setLoading(false)
          const iv = intervalRef.current
          if (iv != null) timer = setTimeout(run, iv)
        }
      }
    }
    run()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, interval])

  const refresh = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, refresh }
}

/** Re-render every `ms` so relative times stay fresh. */
export function useNow(ms = 30000) {
  const [, set] = useState(0)
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}
