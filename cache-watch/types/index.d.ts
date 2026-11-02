export type CacheSnapshot = {
  /** When the last main-thread response arrived, in `$.clock.now()` milliseconds. */
  at: number
  /** Model id that answered. */
  model: string
  /** Tokens the next request re-sends: input + cache read + cache write + output. */
  contextTokens: number
  /** Tokens that response read from the cache. */
  readTokens: number
  /** Tokens that response wrote to the cache. */
  writeTokens: number
  /** Cache lifetime in effect: the configured one until a gap between calls shows otherwise. */
  ttl: '5m' | '1h'
  /** Whether that response found almost nothing in the cache although the prompt was large. */
  wasMiss: boolean
  /** Whether the miss came sooner than the cache lifetime allows (invalidated, not expired). */
  droppedEarly: boolean
  /** What that response cost as /cost totals it, in USD; null when the ledger did not move. */
  lastCallUsd: number | null
  /** Input price in USD per million tokens worked back from the real cost; null until known. */
  unitPrice: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'cache-watch': { last: CacheSnapshot | null; now: number; isHidden: boolean }
  }
}
