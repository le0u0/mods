import type { Register } from 'claude-code'

import { registerMinimalView } from './minimal-view'

export const register: Register = on => {
  registerMinimalView(on)
}
