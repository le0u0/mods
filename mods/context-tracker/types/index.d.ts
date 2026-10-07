export type ContextTrackerItem = {
  name: string
  tokens: number
}

export type ContextTrackerRow = {
  name: string
  tokens: number
  color: string
  kind: 'used' | 'free' | 'buffer' | 'deferred'
  items: ContextTrackerItem[]
}

export type ContextTrackerUsage = {
  rows: ContextTrackerRow[]
  totalTokens: number
  maxTokens: number
  percent: number
  compactAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'context-tracker': {
      isShown: boolean
      isCollapsed: boolean
      openRow: string | null
      itemLimit: number
      turnBase: number | null
      usage: ContextTrackerUsage | null
    }
  }
}
