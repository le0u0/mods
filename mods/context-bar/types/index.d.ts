export type ContextBarItem = {
  name: string
  tokens: number
}

export type ContextBarRow = {
  name: string
  tokens: number
  color: string
  kind: 'used' | 'free' | 'buffer' | 'deferred'
  items: ContextBarItem[]
}

export type ContextBarUsage = {
  rows: ContextBarRow[]
  totalTokens: number
  maxTokens: number
  percent: number
  compactAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': {
      isShown: boolean
      isCollapsed: boolean
      openRow: string | null
      itemLimit: number
      turnBase: number | null
      usage: ContextBarUsage | null
    }
  }
}
