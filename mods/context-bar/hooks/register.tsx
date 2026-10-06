import type { Register } from 'claude-code'

import { registerContextBar } from './context-bar'

export const register: Register = on => {
  registerContextBar(on)
}
