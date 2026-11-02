export type UsageWindow = {
  /** `five_hour` or `seven_day`. */
  kind: string
  /** 0 to 100. */
  percentUsed: number
  /** When the window resets, in epoch milliseconds; null when unknown. */
  resetsAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-watch': { windows: UsageWindow[]; now: number; isHidden: boolean }
  }
}
