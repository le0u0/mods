// One usage-limit window as the last response reported it: `five_hour` (the
// current session), `seven_day` (the current week) or another the account has.
export type UsageTrackerLimit = {
  kind: string
  percentUsed: number
  resetsAt: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-tracker': {
      isShown: boolean
      limits: UsageTrackerLimit[]
      turnBase: number | null
      lastDelta: number | null
    }
  }
}
