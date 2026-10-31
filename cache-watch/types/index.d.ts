export type CacheSnapshot = {
  /** When the last main-thread response arrived, in `$.clock.now()` milliseconds. */
  at: number
  /** Model id that answered. */
  model: string
  /** Tokens the next request re-sends: input + cache read + cache write + output. */
  contextTokens: number
  /** Tokens that response read from the cache. */
  readTokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'cache-watch': { last: CacheSnapshot | null; now: number; isHidden: boolean }
  }
}
