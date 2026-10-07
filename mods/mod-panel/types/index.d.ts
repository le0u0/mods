// A mod the panel lists: its plugin name, what the row shows, and the slash
// command it registers, which tells the panel it is installed.
export type ModPanelMod = {
  id: 'minimal-view' | 'context-tracker' | 'usage-tracker'
  name: string
  hint: string
  about: string
  command: string
}

// The panel's request to turn one mod on or off. Each mod hooks `state.set` on
// this value and switches itself, so nothing shows in the transcript.
export type ModPanelSwitch = {
  mod: ModPanelMod['id']
  isOn: boolean
}

// The part of context-tracker's usage the panel draws when its row is opened.
export type ModPanelUsage = {
  rows: { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' | 'deferred' }[]
  totalTokens: number
  maxTokens: number
  percent: number
  compactAt: number | null
}

// One of usage-tracker's usage-limit windows, drawn when its row is opened.
export type ModPanelLimit = {
  kind: string
  percentUsed: number
  resetsAt: string | null
}

// The panel's own values, and those it reads from the mods it controls.
declare module 'claude-code' {
  interface PluginState {
    'mod-panel': {
      isOpen: boolean
      installed: ModPanelMod['id'][]
      switch: ModPanelSwitch | null
      page: ModPanelMod['id'] | null
    }
    'minimal-view': {
      minimalViewEnabled: boolean
    }
    'context-tracker': {
      isShown: boolean
      usage: ModPanelUsage | null
    }
    'usage-tracker': {
      isShown: boolean
      limits: ModPanelLimit[]
    }
  }
}
