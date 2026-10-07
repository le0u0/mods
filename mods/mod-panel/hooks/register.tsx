import type { Register } from 'claude-code'

import { registerModPanel } from './mod-panel'

export const register: Register = on => {
  registerModPanel(on)
}
