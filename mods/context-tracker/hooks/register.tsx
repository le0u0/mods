import type { Register } from 'claude-code'

import { registerContextTracker } from './context-tracker'

export const register: Register = on => {
  registerContextTracker(on)
}
