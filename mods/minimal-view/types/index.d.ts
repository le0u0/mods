export type MinimalViewTaskStatus = 'done' | 'active' | 'upcoming'

export type MinimalViewTask = {
  id: string
  name: string
  status: MinimalViewTaskStatus
  percent: number
  hasReported: boolean
}

export type MinimalViewPhase = 'working' | 'needs-you' | 'stuck' | 'stopped' | 'done'

export type MinimalViewChecklist = {
  jobId: number
  title: string
  phase: MinimalViewPhase
  tasks: MinimalViewTask[]
  isPlanned: boolean
  needsYouReason: string | null
  stuckReason: string | null
  startedAt: number
  finishedAt: number | null
  tokens: number
  isCollapsed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'minimal-view': {
      minimalViewEnabled: boolean
      checklist: MinimalViewChecklist | null
      tick: number
    }
  }
}
