import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type {
  MinimalViewChecklist,
  MinimalViewPhase,
  MinimalViewTask,
  MinimalViewTaskStatus,
} from '../types'

type $ = EngineInterface

const enabledAtom = atom({ plugin: 'minimal-view', key: 'minimalViewEnabled' } as const, true)
const checklistAtom = atom({ plugin: 'minimal-view', key: 'checklist' } as const, null)
const tickAtom = atom({ plugin: 'minimal-view', key: 'tick' } as const, 0)

const STORE_KEY = 'minimalViewEnabled'
const PLAN_TOOL = 'mcp__minimal-view__plan_steps'
const PROGRESS_TOOL = 'mcp__minimal-view__report_progress'
const ALWAYS_ALLOWED = new Set([
  'ToolSearch',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'AskUserQuestion',
  PLAN_TOOL,
])
const MAX_NAME = 40
const METER_CELLS = 10
const FAILS_BEFORE_STUCK = 3
const COLLAPSE_AFTER_MS = 5000
const TICK_MS = 250

const UNDERSTAND_STEP = 'Understand your request'
const ANSWER_STEP = 'Write the answer'
const NEEDS_OK = 'Claude needs your OK to continue'
const HAS_QUESTION = 'Claude has a question for you'
const WAITING_FOR_REPLY = 'Claude is waiting for your reply'
const SAID_NO = 'you said no to a step, so Claude paused'
const KEEPS_FAILING = 'a step keeps failing, Claude is trying another way'
const REFUSED = "Claude couldn't help with that request"

const SYSTEM_SECTION = `# Minimal View checklist

The person sees a plain checklist of your plan instead of your tool calls.

- Write every step name in plain English a non-technical person understands. Keep it under 40 characters and start it with a verb, like "Build the pricing section".
- Never put file paths, file names, commands, code or tool names in a step name.
- For every request, even a quick question, call \`${PLAN_TOOL}\` first with 2 to 8 steps in order. Load it with ToolSearch if it is deferred. Then call \`${PROGRESS_TOOL}\` as real progress happens, and with 100 the moment a step finishes.
- If this session has TodoWrite or TaskCreate, you can use your to-do list as the plan instead.
- The checklist is not your reply. Your plan always ends with a "${ANSWER_STEP}" step: once the other steps are done, write your answer to the person in plain text.`

// Every step name and job title passes through here.
export function cleanName(raw: string): string {
  const words = raw
    .replace(/`[^`]*`/g, ' ')
    .split(/\s+/)
    .filter(word => word !== '' && !word.includes('/') && !/\.(tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|zsh|json|ya?ml|toml|md|html|css|scss|sql|vue|svelte)[.,;:!?)]*$/i.test(word))
  let name = words.join(' ').trim()
  if (name === '') {
    return 'Working on it'
  }
  name = name.charAt(0).toUpperCase() + name.slice(1)
  if (name.length <= MAX_NAME) {
    return name
  }
  const cut = name.slice(0, MAX_NAME - 1)
  const space = cut.lastIndexOf(' ')

  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,.;:-]+$/, '')}…`
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// Tokens a request spent; cache reads are left out, as they re-read context already paid for.
function spentTokens(usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null } | undefined): number {
  return usage === undefined ? 0 : usage.input_tokens + usage.output_tokens + (usage.cache_creation_input_tokens ?? 0)
}

export function formatTokens(tokens: number): string {
  return tokens < 1000 ? `${tokens} tokens` : `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}k tokens`
}

function clampPercent(value: unknown): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 0

  return Math.round(Math.min(100, Math.max(0, number)))
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function isRunning(checklist: MinimalViewChecklist | null): checklist is MinimalViewChecklist {
  return checklist !== null && (checklist.phase === 'working' || checklist.phase === 'needs-you' || checklist.phase === 'stuck')
}

function makeTasks(names: readonly string[], prefix: string): MinimalViewTask[] {
  return names.map((name, index) => ({
    id: `${prefix}-${index}`,
    name: cleanName(name),
    status: index === 0 ? 'active' : 'upcoming',
    percent: 0,
    hasReported: false,
  }))
}

// Checks off everything before `index`, makes it the current step and moves on when it reaches 100.
function reportOn(tasks: MinimalViewTask[], index: number, percent: number): MinimalViewTask[] {
  const next = tasks.map((task, at): MinimalViewTask => {
    if (at < index) {
      return { ...task, status: 'done', percent: 100 }
    }
    if (at === index) {
      return { ...task, status: percent >= 100 ? 'done' : 'active', percent, hasReported: true }
    }

    return task.status === 'active' ? { ...task, status: 'upcoming' } : task
  })
  if (percent >= 100) {
    const following = next.findIndex((task, at) => at > index && task.status === 'upcoming')
    if (following !== -1) {
      next[following] = { ...next[following]!, status: 'active', percent: 0, hasReported: false }
    }
  }

  return next
}

function apiErrorSentence(error: string, details: string | undefined): string {
  const text = `${error} ${details ?? ''}`
  if (/prompt.{0,10}too long|context|too many tokens/i.test(text)) {
    return 'type /compact and try again'
  }
  if (/network|connect|socket|ECONN|ETIMEDOUT|fetch failed|offline/i.test(text)) {
    return 'the internet connection dropped'
  }
  switch (error) {
    case 'rate_limit':
    case 'billing_error':
      return 'you hit your usage limit, try again a little later'
    case 'overloaded':
    case 'server_error':
      return "Claude's servers are busy, try again in a minute"
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'cloud_credential_error':
      return 'type /login'
    default:
      return 'something went wrong, try again in a minute'
  }
}

let ticker: Timer | null = null
let collapseTimer: Timer | null = null
let failStreak = 0
let jobCounter = 0
let apiError: string | null = null

async function setChecklist(
  $: $,
  change: (checklist: MinimalViewChecklist | null) => MinimalViewChecklist | null,
): Promise<void> {
  syncTimers($, await update($, checklistAtom, change))
}

function patchRunning($: $, change: (checklist: MinimalViewChecklist) => MinimalViewChecklist): Promise<void> {
  return setChecklist($, checklist => (isRunning(checklist) ? change(checklist) : checklist))
}

// The frame clock runs only while a job is working or waiting on the person.
function syncTimers($: $, checklist: MinimalViewChecklist | null): void {
  const isAnimated = checklist !== null && (checklist.phase === 'working' || checklist.phase === 'needs-you')
  if (isAnimated && ticker === null) {
    ticker = $.clock.every(TICK_MS, () => {
      void update($, tickAtom, tick => tick + 1)
    })
  }
  if (!isAnimated && ticker !== null) {
    ticker.cancel()
    ticker = null
  }
}

function scheduleCollapse($: $, jobId: number): void {
  collapseTimer?.cancel()
  collapseTimer = $.clock.after(COLLAPSE_AFTER_MS, () => {
    collapseTimer = null
    void setChecklist($, checklist =>
      checklist !== null && checklist.jobId === jobId && checklist.phase === 'done'
        ? { ...checklist, isCollapsed: true }
        : checklist,
    )
  })
}

async function setEnabled($: $, isEnabled: boolean): Promise<void> {
  await update($, enabledAtom, () => isEnabled)
  await $.store.set(STORE_KEY, isEnabled)
}

async function startJob($: $, prompt: string): Promise<void> {
  jobCounter += 1
  const jobId = jobCounter
  failStreak = 0
  apiError = null
  collapseTimer?.cancel()
  const startedAt = await $.clock.now()
  await setChecklist($, () => ({
    jobId,
    title: 'Working on your request',
    phase: 'working',
    tasks: makeTasks([UNDERSTAND_STEP], `placeholder-${jobId}`),
    isPlanned: false,
    needsYouReason: null,
    stuckReason: null,
    startedAt,
    finishedAt: null,
    isCollapsed: false,
    tokens: 0,
  }))
  $.clock.after(1, () => {
    // A model the session cannot reach leaves the placeholder title.
    nameJob($, jobId, prompt).catch(() => undefined)
  })
}

async function nameJob($: $, jobId: number, prompt: string): Promise<void> {
  const reply = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 30,
    timeoutMs: 15000,
    system: 'You name tasks for a progress checklist.',
    prompt: `Name this request in 2 to 6 plain words that start with a verb. No file names, code or punctuation. Reply with the name only.\n\nRequest:\n${prompt.slice(0, 2000)}`,
  })
  const tokens = spentTokens(reply.usage)
  await setChecklist($, checklist =>
    checklist !== null && checklist.jobId === jobId ? { ...checklist, tokens: checklist.tokens + tokens } : checklist,
  )
  if (!reply.isAnswered) {
    return
  }
  const words = reply.text.replace(/["'*_#.]/g, '').trim().split(/\s+/).slice(0, 6).join(' ')
  const title = cleanName(words)
  await setChecklist($, checklist =>
    checklist !== null && checklist.jobId === jobId ? { ...checklist, title } : checklist,
  )
}

// A plan from plan_steps or a to-do list replaces the placeholders; a job starts if none runs.
async function applyPlan($: $, tasks: MinimalViewTask[]): Promise<void> {
  const startedAt = await $.clock.now()
  await setChecklist($, checklist => {
    if (isRunning(checklist)) {
      return { ...checklist, tasks, isPlanned: true }
    }
    jobCounter += 1

    return {
      jobId: jobCounter,
      title: tasks[0]?.name ?? 'Working on it',
      phase: 'working',
      tasks,
      isPlanned: true,
      needsYouReason: null,
      stuckReason: null,
      startedAt,
      finishedAt: null,
      isCollapsed: false,
      tokens: 0,
    }
  })
}

async function finishJob($: $, phase: MinimalViewPhase, change: Partial<MinimalViewChecklist>): Promise<void> {
  const finishedAt = await $.clock.now()
  await setChecklist($, current => (isRunning(current) ? { ...current, ...change, phase, finishedAt } : current))
  const checklist = await read($, checklistAtom)
  if (phase === 'done' && checklist !== null && checklist.phase === 'done') {
    scheduleCollapse($, checklist.jobId)
  }
}

// A step that is the reply to the person itself, like "Write the answer" or "Reply to you";
// not work that merely mentions one, like "Respond to review comments".
export function isAnswerStep(name: string): boolean {
  return /^(write|give|send)( the| your| my| an?)? (answer|reply|response)( to (you|the person|the question))?$/i.test(name.trim())
    || /^(answer|reply|respond)( to (you|the person|the question))?$/i.test(name.trim())
}

// Every plan ends with writing the answer, so the checklist never ends before the reply does.
export function withAnswerStep(names: readonly string[]): string[] {
  return isAnswerStep(names.at(-1) ?? '') ? [...names] : [...names, ANSWER_STEP]
}

// A reply that starts with no plan (a quick question) moves the placeholders on to writing the answer.
async function startAnswer($: $): Promise<void> {
  await patchRunning($, current =>
    current.isPlanned || current.tasks.some(task => task.name === ANSWER_STEP)
      ? current
      : {
          ...current,
          tasks: [
            { id: `placeholder-${current.jobId}-0`, name: UNDERSTAND_STEP, status: 'done', percent: 100, hasReported: true },
            { id: `placeholder-${current.jobId}-answer`, name: ANSWER_STEP, status: 'active', percent: 0, hasReported: false },
          ],
        },
  )
}

export function registerMinimalView(on: On): void {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(STORE_KEY)
    await update($, enabledAtom, () => stored !== false)
    await $.tool.register({
      name: 'plan_steps',
      description:
        'Lay out every step of the job up front, 2 to 8 short plain-English names in order, each starting with a verb. The first step starts right away. Call this first for every request.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
        },
        required: ['steps'],
      },
    })
    await $.tool.register({
      name: 'report_progress',
      description:
        'Report progress on the current step of the plan, by its name and a percent from 0 to 100. Report 100 the moment a step finishes; the next step then starts.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string' },
          percent: { type: 'number', minimum: 0, maximum: 100 },
        },
        required: ['task', 'percent'],
      },
    })
    await $.command.register({
      name: 'minimal',
      description: 'Turn Minimal View on or off',
      argumentHint: 'on|off',
    })

    return next(e)
  })

  // The mod-panel plugin turns this mod on or off by writing its `switch` request.
  on('state.set', { plugin: 'mod-panel', key: 'switch' } as never, async ($, e, next) => {
    const result = await next(e)
    const request = (e as { value?: { mod?: string; isOn?: boolean } | null }).value
    if (request?.mod === 'minimal-view' && typeof request.isOn === 'boolean') {
      await setEnabled($, request.isOn)
    }

    return result
  })

  on('command.run', { command: 'minimal' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') {
      return { text: 'Use /minimal on, /minimal off, or /minimal to switch.' }
    }
    const isEnabled = arg === '' ? !(await read($, enabledAtom)) : arg === 'on'
    await setEnabled($, isEnabled)

    return { text: isEnabled ? 'Minimal View is on.' : 'Minimal View is off.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, enabledAtom))) {
      return composed
    }

    return {
      sections: [...composed.sections, { id: 'minimal-view:checklist', text: SYSTEM_SECTION, scope: 'session' }],
    }
  })

  on('turn.start', async ($, e, next) => {
    const isCommand = e.text.trimStart().startsWith('/')
    const checklist = await read($, checklistAtom)
    if (isRunning(checklist)) {
      await patchRunning($, current => ({ ...current, phase: 'working', needsYouReason: null, stuckReason: null }))
    } else if (e.text.trim() !== '' && !isCommand) {
      await startJob($, e.text)
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    let isAnswering = e.agentId !== undefined
    for await (const chunk of stream) {
      if (!isAnswering && chunk.kind === 'text' && chunk.text.trim() !== '') {
        isAnswering = true
        await startAnswer($)
      }
      yield chunk
    }

    return await stream.result
  })

  on('tool.call', { tool: /^mcp__minimal-view__plan_steps$/ }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { result: 'Only the main agent plans the steps. Carry on with your task.' }
    }
    const input = e as unknown as { steps?: unknown }
    const names = (Array.isArray(input.steps) ? input.steps : []).filter((step): step is string => typeof step === 'string').slice(0, 8)
    if (names.length === 0) {
      return { result: 'Give at least one step name in `steps`.' }
    }
    const steps = withAnswerStep(names)
    await applyPlan($, makeTasks(steps, `plan-${e.tool_use_id}`))
    const added = steps.length > names.length ? ` (yours, then "${ANSWER_STEP}")` : ''

    return { result: `Planned ${steps.length} steps${added}. The first one has started. After the last one, write your answer to the person.` }
  })

  on('tool.call', { tool: /^mcp__minimal-view__report_progress$/ }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { result: 'Progress noted.' }
    }
    const input = e as unknown as { task?: unknown; percent?: unknown }
    const name = cleanName(typeof input.task === 'string' ? input.task : '')
    const percent = clampPercent(input.percent)
    const checklist = await read($, checklistAtom)
    if (!isRunning(checklist)) {
      await applyPlan($, makeTasks([name], `plan-${e.tool_use_id}`))
    }
    await patchRunning($, current => {
      let tasks = current.tasks
      let index = tasks.findIndex(task => sameName(task.name, name))
      if (index === -1) {
        const active = tasks.findIndex(task => task.status !== 'done')
        index = active === -1 ? tasks.length : active
        const added: MinimalViewTask = { id: `step-${e.tool_use_id}`, name, status: 'upcoming', percent: 0, hasReported: false }
        tasks = [...tasks.slice(0, index), added, ...tasks.slice(index)]
      }

      return { ...current, tasks: reportOn(tasks, index, percent) }
    })
    const after = await read($, checklistAtom)
    const isAnswerNext = after !== null && after.tasks.every(task => task.status === 'done' || isAnswerStep(task.name))

    return { result: isAnswerNext ? `Progress noted: ${percent}%. Every step is done: now write your answer to the person.` : `Progress noted: ${percent}%.` }
  })

  // The plan-first gate, then what Claude already does turned into checklist state.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    const tool = String(e.tool)
    if (!ALWAYS_ALLOWED.has(tool) && (await read($, enabledAtom))) {
      const checklist = await read($, checklistAtom)
      const isPlanToolReady = (await $.tool.list()).some(info => info.name === PLAN_TOOL)
      if (isPlanToolReady && (!isRunning(checklist) || !checklist.isPlanned)) {
        return {
          deny: `Minimal View: call ${PLAN_TOOL} first to lay out the plan in plain steps (load it with ToolSearch if it is deferred), then try again.`,
        }
      }
    }
    await patchRunning($, current =>
      current.phase === 'needs-you' ? { ...current, phase: 'working', needsYouReason: null } : current,
    )
    if (tool === 'AskUserQuestion') {
      await patchRunning($, current => ({ ...current, phase: 'needs-you', needsYouReason: HAS_QUESTION }))
    }
    const ran = await next(e)
    if (ran.deny !== undefined) {
      return ran
    }

    if (tool === 'TodoWrite' && !ran.isError) {
      const input = e as unknown as { todos?: { content: string; status: string }[] }
      const todos = input.todos ?? []
      const statusOf = (status: string): MinimalViewTaskStatus =>
        status === 'completed' ? 'done' : status === 'in_progress' ? 'active' : 'upcoming'
      const previous = (await read($, checklistAtom))?.tasks ?? []
      const tasks = todos.map((todo, index): MinimalViewTask => {
        const name = cleanName(todo.content)
        const status = statusOf(todo.status)
        const before = previous.find(task => sameName(task.name, name))

        return {
          id: `todo-${index}`,
          name,
          status,
          percent: status === 'done' ? 100 : (before?.percent ?? 0),
          hasReported: before?.hasReported ?? false,
        }
      })
      if (tasks.length > 0) {
        await applyPlan($, tasks)
      }
    }

    if (tool === 'TaskCreate' && !ran.isError) {
      const input = e as unknown as { subject?: string }
      const created = ran.result as { task?: { id?: string } } | undefined
      const id = `task-${created?.task?.id ?? e.tool_use_id}`
      const task: MinimalViewTask = { id, name: cleanName(input.subject ?? ''), status: 'upcoming', percent: 0, hasReported: false }
      const checklist = await read($, checklistAtom)
      const kept = isRunning(checklist) && checklist.isPlanned ? checklist.tasks : []
      await applyPlan($, [...kept, task])
    }

    if (tool === 'TaskUpdate' && !ran.isError) {
      const input = e as unknown as { taskId?: string; status?: string; subject?: string }
      const id = `task-${input.taskId ?? ''}`
      await patchRunning($, current => {
        if (input.status === 'deleted') {
          return { ...current, tasks: current.tasks.filter(task => task.id !== id) }
        }
        const tasks = current.tasks.map((task): MinimalViewTask => {
          if (task.id !== id) {
            return input.status === 'in_progress' && task.status === 'active' ? { ...task, status: 'upcoming' } : task
          }
          const name = input.subject !== undefined ? cleanName(input.subject) : task.name
          if (input.status === 'completed') {
            return { ...task, name, status: 'done', percent: 100 }
          }
          if (input.status === 'in_progress') {
            return { ...task, name, status: 'active' }
          }
          if (input.status === 'pending') {
            return { ...task, name, status: 'upcoming' }
          }

          return { ...task, name }
        })

        return { ...current, tasks }
      })
    }

    if (tool === 'AskUserQuestion') {
      await patchRunning($, current =>
        current.needsYouReason === HAS_QUESTION ? { ...current, phase: 'working', needsYouReason: null } : current,
      )
    }

    if (ran.isError === true) {
      const text = typeof ran.text === 'string' ? ran.text : ''
      if (/doesn't want to proceed|user (rejected|denied|declined)|permission (was )?denied/i.test(text)) {
        failStreak = 0
        await patchRunning($, current => ({ ...current, phase: 'stuck', stuckReason: SAID_NO, needsYouReason: null }))
      } else {
        failStreak += 1
        if (failStreak >= FAILS_BEFORE_STUCK) {
          await patchRunning($, current => ({ ...current, phase: 'stuck', stuckReason: KEEPS_FAILING, needsYouReason: null }))
        }
      }
    } else {
      failStreak = 0
      await patchRunning($, current =>
        current.phase === 'stuck' || current.phase === 'needs-you'
          ? { ...current, phase: 'working', stuckReason: null, needsYouReason: null }
          : current,
      )
    }

    return ran
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'Minimal View: call plan_steps first.' }))

  on('classic.Notification', async ($, e, next) => {
    if (e.agent_id === undefined && /permission|elicitation/i.test(e.notification_type)) {
      await patchRunning($, current => ({ ...current, phase: 'needs-you', needsYouReason: NEEDS_OK }))
    }

    return next(e)
  })

  on('classic.PermissionDenied', async ($, e, next) => {
    if (e.agent_id === undefined) {
      await patchRunning($, current => ({ ...current, phase: 'stuck', stuckReason: SAID_NO, needsYouReason: null }))
    }

    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    if (e.agent_id === undefined) {
      apiError = apiErrorSentence(e.error, e.error_details)
      await setChecklist($, checklist =>
        checklist !== null && (checklist.phase === 'done' || isRunning(checklist))
          ? { ...checklist, phase: 'stuck', stuckReason: apiError, needsYouReason: null, isCollapsed: false }
          : checklist,
      )
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    const tokens = spentTokens(e.usage)
    await patchRunning($, current => ({ ...current, tokens: current.tokens + tokens }))
    const checklist = await read($, checklistAtom)
    if (isRunning(checklist)) {
      if (e.reason === 'aborted') {
        await finishJob($, 'stopped', { needsYouReason: null, stuckReason: null })
      } else if (e.reason === 'refusal') {
        await patchRunning($, current => ({ ...current, phase: 'stuck', stuckReason: REFUSED, needsYouReason: null }))
      } else if (e.reason === 'error') {
        const reason = apiError ?? 'something went wrong, try again in a minute'
        await patchRunning($, current => ({ ...current, phase: 'stuck', stuckReason: reason, needsYouReason: null }))
      } else if (checklist.phase === 'stuck') {
        // Stuck stays on screen until the next success or prompt.
      } else if (checklist.isPlanned && checklist.tasks.some(task => task.status === 'upcoming' && !isAnswerStep(task.name))) {
        // Only steps not yet started mean Claude is waiting on you: the last step is often the reply itself.
        await patchRunning($, current => ({ ...current, phase: 'needs-you', needsYouReason: WAITING_FOR_REPLY }))
      } else {
        await finishJob($, 'done', {
          needsYouReason: null,
          stuckReason: null,
          tasks: checklist.tasks.map(task => ({ ...task, status: 'done', percent: 100 })),
        })
      }
    }
    apiError = null

    return next(e)
  })

  on('ui.render', { component: /^(ToolUse|ToolResult|ToolGroup|Spinner|TurnDuration)$/ }, async ($, e, next) =>
    (await read($, enabledAtom)) ? <></> : next(e),
  )

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) =>
    (await read($, enabledAtom)) ? next({ ...e, props: { ...e.props, hint: '' } }) : next(e),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    // The mod-panel button turns this mod on and off; idle, the band is empty.
    const isEnabled = await read($, enabledAtom)
    const checklist = isEnabled ? await read($, checklistAtom) : null
    if (checklist === null) {
      return next(e)
    }
    const width = Math.max(20, e.props.bodyColumns)
    const header = (left: ReturnType<typeof Text>) => (
      <Box flexDirection="row" width={width}>
        <Box flexShrink={1}>{left}</Box>
      </Box>
    )

    // Rows from later plugins, like the context tracker, stay below the band.
    const below = await next(e)
    const stack = (band: ReturnType<typeof Box>) => (
      <Box flexDirection="column">
        {band}
        {below}
      </Box>
    )

    const tick = await read($, tickAtom)
    const now = await $.clock.now()
    const elapsed = formatDuration((checklist.finishedAt ?? now) - checklist.startedAt)
    const isPaused = checklist.phase === 'needs-you'

    const headerText = (() => {
      switch (checklist.phase) {
        case 'needs-you':
          return (
            <Text wrap="truncate-end">
              <Text inverse bold color="warning"> Needs you </Text>
              <Text> {checklist.needsYouReason ?? WAITING_FOR_REPLY}</Text>
            </Text>
          )
        case 'stuck':
          return (
            <Text wrap="truncate-end" color="warning">
              ⚠ Stuck: {checklist.stuckReason ?? KEEPS_FAILING}
            </Text>
          )
        case 'stopped':
          return (
            <Text wrap="truncate-end">
              ■ Stopped · {checklist.title} · you pressed Esc
            </Text>
          )
        case 'done':
          return (
            <Text wrap="truncate-end" color="success">
              ✓ All done · took {elapsed}
              {checklist.tokens > 0 ? ` · ${formatTokens(checklist.tokens)}` : ''}
            </Text>
          )
        default:
          return (
            <Text wrap="truncate-end">
              <Text bold>{checklist.title}</Text>
              <Text dimColor> · {elapsed}</Text>
            </Text>
          )
      }
    })()

    if (checklist.phase === 'done' && checklist.isCollapsed) {
      return stack(header(headerText))
    }

    const labelWidth = 8
    const nameWidth = Math.max(8, width - 2 - 1 - METER_CELLS - 2 - labelWidth)
    const fit = (name: string) => {
      const short = name.length > nameWidth ? `${name.slice(0, nameWidth - 1)}…` : name

      return short.padEnd(nameWidth)
    }
    const firstUpcoming = checklist.tasks.findIndex(task => task.status === 'upcoming')

    const rows = checklist.tasks.map((task, index) => {
      if (task.status === 'done') {
        return (
          <Box key={`row-${task.id}`} flexDirection="row">
            <Text color="success">✓ </Text>
            <Text dimColor>{fit(task.name)} </Text>
            <Text color="success">{'█'.repeat(METER_CELLS)}</Text>
            <Text dimColor>  Done</Text>
          </Box>
        )
      }
      if (task.status === 'active') {
        const meter = task.hasReported || isPaused
          ? '█'.repeat(Math.round(task.percent / 10)).padEnd(METER_CELLS, '░')
          : Array.from({ length: METER_CELLS }, (_, cell) => ((cell - tick) % METER_CELLS + METER_CELLS) % METER_CELLS < 3 ? '█' : '░').join('')

        return (
          <Box key={`row-${task.id}`} flexDirection="row">
            <Text color={isPaused ? 'warning' : 'claude'}>{isPaused ? '‖ ' : '▶ '}</Text>
            <Text bold>{fit(task.name)} </Text>
            <Text color="claude">{meter}</Text>
            <Text>  {isPaused ? 'Paused' : task.hasReported ? `${task.percent}%` : 'Working'}</Text>
          </Box>
        )
      }

      return (
        <Box key={`row-${task.id}`} flexDirection="row">
          <Text dimColor>○ </Text>
          <Text dimColor>{fit(task.name)} </Text>
          <Text dimColor>{'░'.repeat(METER_CELLS)}</Text>
          <Text dimColor>  {index === firstUpcoming ? 'Next' : 'Up next'}</Text>
        </Box>
      )
    })

    return stack(
      <Box flexDirection="column">
        {header(headerText)}
        {rows}
      </Box>,
    )
  })
}
