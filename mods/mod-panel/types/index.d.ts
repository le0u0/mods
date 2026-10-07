// A mod the panel lists: its plugin name, what the row shows, and the slash
// command that turns it on or off.
export type ModPanelMod = {
  id: 'minimal-view' | 'context-bar'
  name: string
  hint: string
  command: string
}

// The values this panel reads from the mods it controls. Each owner writes its
// own; the panel only reads them, and turns a mod on or off through its command.
declare module 'claude-code' {
  interface PluginState {
    'mod-panel': {
      isOpen: boolean
      installed: ModPanelMod['id'][]
    }
    'minimal-view': {
      minimalViewEnabled: boolean
    }
    'context-bar': {
      isShown: boolean
    }
  }
}
