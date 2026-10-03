import { createContext, useContext, useEffect } from 'react'
import { ApiError } from '../api'
import { usePoll } from '../hooks'
import type { PollState } from '../hooks'

export interface OpCtx {
  logout: (reason?: string) => void
}
export const OperatorContext = createContext<OpCtx>({ logout: () => {} })
export const useOperator = () => useContext(OperatorContext)

export const OP_POLL_MS = 3000

/** Poll an operator endpoint every 3 s; a 401 sends the user back to the token gate. */
export function useOpPoll<T>(fn: () => Promise<T>, key = ''): PollState<T> {
  const { logout } = useOperator()
  const st = usePoll(fn, OP_POLL_MS, key)
  useEffect(() => {
    if (st.error instanceof ApiError && st.error.status === 401) logout('Token rejected (401). Enter a valid operator token.')
  }, [st.error, logout])
  return st
}

export function isUnauthorized(e: unknown) {
  return e instanceof ApiError && e.status === 401
}
