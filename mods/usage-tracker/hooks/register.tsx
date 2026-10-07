import type { Register } from 'claude-code'

import { registerUsageTracker } from './usage-tracker'

export const register: Register = on => {
  registerUsageTracker(on)
}
