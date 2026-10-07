import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cleanName, withAnswerStep } from './minimal-view'

const PLAN = 'mcp__minimal-view__plan_steps'
const PROGRESS = 'mcp__minimal-view__report_progress'
const BAND = {
  plugin: 'minimal-view',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

// The engine beneath the plugin: every tool answers, Haiku names the job.
// Every command the mod registered, in order.
const registered: string[] = []

function engine(on: On, { hasPlanTool = true } = {}) {
  const clock = mock.clock(on)
  on('tool.list', () => ({ value: hasPlanTool ? [{ name: PLAN, description: '', mcp: true }, { name: PROGRESS, description: '', mcp: true }] : [] }))
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__minimal-view__${e.name}` } }))
  on('command.register', ($, e) => (registered.push(e.name), { value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })
  on('classic.Notification', () => ({}))
  on('tool.call', ($, e) => ({ result: `ran ${String(e.tool)}` }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Build the landing page', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))

  return clock
}

async function startJob($: Engine) {
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'Make me a landing page', turnId: 't1' })
}

let callCount = 0
function call($: Engine, tool: string, input: Record<string, unknown> = {}) {
  callCount += 1

  return $.tool.call({ tool, tool_use_id: `call-${callCount}`, ...input } as never)
}

test('names are cleaned to plain words', () => {
  expect(cleanName('Build the pricing section in `src/Pricing.tsx`')).toBe('Build the pricing section in')
  expect(cleanName('update src/app/page footer links')).toBe('Update footer links')
  expect(cleanName('fix Pricing.tsx and styles.css now')).toBe('Fix and now')
  const long = cleanName('Write a very long step name that goes on and on well past the forty character limit here')
  expect(long.length).toBeLessThanOrEqual(40)
  expect(long).toEndWith('…')
  expect(cleanName('`npm test`')).toBe('Working on it')
})

test('a to-do list and a 60% report draw done, current, next and later rows', async ($, on) => {
  engine(on)
  await startJob($)
  await call($, 'TodoWrite', {
    todos: [
      { content: 'Read your brand notes', status: 'completed', activeForm: 'Reading' },
      { content: 'Build the pricing section', status: 'in_progress', activeForm: 'Building' },
      { content: 'Add the contact form', status: 'pending', activeForm: 'Adding' },
      { content: 'Polish the footer', status: 'pending', activeForm: 'Polishing' },
    ],
  })
  await call($, PROGRESS, { task: 'Build the pricing section', percent: 60 })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: '✓ ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▶ ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /60%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s*Next$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Up next/ })).toBeDefined()
    expect(await ui.find({ key: 'toggle' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a permission prompt shows Needs you', async ($, on) => {
  engine(on)
  await startJob($)
  await call($, PLAN, { steps: ['Read the notes', 'Write the page'] })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '‖ ' })).toBeDefined()
  await ui.unmount()
})

test('/minimal off hides the band and shows tool rows again', async ($, on) => {
  engine(on)
  await startJob($)
  await call($, PLAN, { steps: ['Read the notes', 'Write the page'] })
  const hidden = await $.ui.mount({ plugin: 'minimal-view', surface: 'terminal', component: 'ToolUse', props: { tool_use_id: 'x', tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false } })
  expect(await hidden.find({ type: 'Text' })).toBeUndefined()
  await hidden.unmount()
  const duration = await $.ui.mount({ plugin: 'minimal-view', surface: 'terminal', component: 'TurnDuration', props: { word: 'Worked', durationMs: 24000 } })
  expect(await duration.find({ type: 'Text' })).toBeUndefined()
  await duration.unmount()
  const spinner = await $.ui.mount({ plugin: 'minimal-view', surface: 'terminal', component: 'Spinner', props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' } })
  expect(await spinner.find({ type: 'Text' })).toBeUndefined()
  await spinner.unmount()

  await $.command.run({ command: 'minimal', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Read the notes/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
  await ui.unmount()
  const shown = await $.ui.mount({ plugin: 'minimal-view', surface: 'terminal', component: 'ToolUse', props: { tool_use_id: 'x', tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false } })
  expect(await shown.find({ type: 'Text', text: 'engine row' })).toBeDefined()
  await shown.unmount()
})

test('plan_steps then 100% checks off step one and starts step two', async ($, on) => {
  engine(on)
  await startJob($)
  const planned = await call($, PLAN, { steps: ['Read the notes', 'Write the page', 'Check the page'] })
  expect(planned.text ?? planned.result).toMatch(/Planned 4 steps \(yours, then "Write the answer"\)/)
  await call($, PROGRESS, { task: 'Read the notes', percent: 100 })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const icons = (await ui.findAll({ type: 'Text', text: /^(✓|▶|○) $/ })).map(found => found.text)
  expect(icons).toEqual(['✓ ', '▶ ', '○ ', '○ '])
  expect(await ui.find({ type: 'Text', text: /Write the page/ })).toMatchObject({ props: { bold: true } })
  expect(await ui.find({ type: 'Text', text: /Write the answer/ })).toBeDefined()
  await ui.unmount()
})

test('once every step is done, Claude is told to write the answer', async ($, on) => {
  engine(on)
  await startJob($)
  await call($, PLAN, { steps: ['Read the notes'] })
  const progress = await call($, PROGRESS, { task: 'Read the notes', percent: 100 })
  expect(progress.text ?? progress.result).toMatch(/now write your answer/)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Write the answer/ })).toMatchObject({ props: { bold: true } })
  await ui.unmount()
})

test('a plan that already ends with the reply gets no extra step', () => {
  expect(withAnswerStep(['Check the code', 'Write the reply'])).toEqual(['Check the code', 'Write the reply'])
  expect(withAnswerStep(['Check the code'])).toEqual(['Check the code', 'Write the answer'])
  expect(withAnswerStep(['Read the PR', 'Respond to review comments'])).toEqual(['Read the PR', 'Respond to review comments', 'Write the answer'])
  expect(withAnswerStep(['Draft response email'])).toEqual(['Draft response email', 'Write the answer'])
})

test('tools are denied before a plan exists and allowed after', async ($, on) => {
  engine(on)
  await startJob($)
  const before = await call($, 'Read', { file_path: '/tmp/a.md' })
  expect(before.deny ?? before.text).toMatch(/plan_steps first/)
  await call($, PLAN, { steps: ['Read the notes', 'Write the page'] })
  const after = await call($, 'Read', { file_path: '/tmp/a.md' })
  expect(after.result).toBe('ran Read')
})

test('a finished job says All done with time and tokens, then shrinks after 5 seconds', async ($, on) => {
  const clock = engine(on)
  await startJob($)
  await clock.advance(10)
  await call($, PLAN, { steps: ['Read the notes', 'Write the page'] })
  await call($, PROGRESS, { task: 'Write the page', percent: 100 })
  await clock.advance(2000)
  await $.turn.complete({ answer: 'Done.', durationMs: 2000, isAborted: false, turnId: 't1', reason: 'answer', usage: { model: 'opus', input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 500, cache_read_input_tokens: 90000 } })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^✓ All done · took 2s · 2k tokens$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Read the notes/ })).toBeDefined()
  await ui.unmount()
  await clock.advance(5000)
  const collapsed = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await collapsed.find({ type: 'Text', text: /All done/ })).toBeDefined()
  expect(await collapsed.find({ type: 'Text', text: /Read the notes/ })).toBeUndefined()
  await collapsed.unmount()
})

test('nothing is blocked when the plan tool could not load', async ($, on) => {
  engine(on, { hasPlanTool: false })
  await startJob($)
  const ran = await call($, 'WebSearch', { query: 'coffee', mode: 'standard' })
  expect(ran.result).toBe('ran WebSearch')
})

test('a quick answer with no plan moves on to writing the answer', async ($, on) => {
  engine(on)
  on('turn.step', async function* ($, e) {
    yield { kind: 'text', index: 0, text: 'MCP is a protocol.' }

    return { turnId: e.turnId, index: e.index, answer: 'MCP is a protocol.', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await startJob($)
  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1 })) {
    void chunk
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const icons = (await ui.findAll({ type: 'Text', text: /^(✓|▶|○) $/ })).map(found => found.text)
  expect(icons).toEqual(['✓ ', '▶ '])
  expect(await ui.find({ type: 'Text', text: /Write the answer/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Plan the steps/ })).toBeUndefined()
  await ui.unmount()
})

test('the band keeps rows from later plugins, like the context tracker, below the checklist', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const idle = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await idle.find({ type: 'Text', text: 'engine row' })).toBeDefined()
  await idle.unmount()

  await $.turn.start({ text: 'Make me a landing page', turnId: 't1' })
  await call($, PLAN, { steps: ['Read the notes', 'Write the page'] })
  const running = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await running.find({ type: 'Text', text: /Read the notes/ })).toBeDefined()
  expect(await running.find({ type: 'Text', text: 'engine row' })).toBeDefined()
  await running.unmount()

  await call($, PROGRESS, { task: 'Write the page', percent: 100 })
  await $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: { model: 'opus', input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } })
  await clock.advance(5000)
  const collapsed = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await collapsed.find({ type: 'Text', text: /All done/ })).toBeDefined()
  expect(await collapsed.find({ type: 'Text', text: 'engine row' })).toBeDefined()
  await collapsed.unmount()
})

test('a new prompt shows only Understand your request until a plan arrives', async ($, on) => {
  engine(on)
  await startJob($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const rows = (await ui.findAll({ type: 'Text', text: /^(✓|▶|○) $/ })).map(found => found.text)
  expect(rows).toEqual(['▶ '])
  expect(await ui.find({ type: 'Text', text: /Understand your request/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Plan the steps/ })).toBeUndefined()
  await ui.unmount()
})

const USAGE = { model: 'opus', input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

test('an answer that ends while the last step runs counts as done', async ($, on) => {
  engine(on)
  await startJob($)
  await call($, PLAN, { steps: ['Read the notes', 'Report the result'] })
  await call($, PROGRESS, { task: 'Read the notes', percent: 100 })
  await $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: USAGE })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeUndefined()
  await ui.unmount()
})

test('an answer that ends with steps still to come shows Needs you', async ($, on) => {
  engine(on)
  await startJob($)
  await call($, PLAN, { steps: ['Ask which design', 'Build the page', 'Check the page'] })
  await $.turn.complete({ answer: 'Which design?', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: USAGE })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeDefined()
  await ui.unmount()
})

test('a paused step stops its meter and says Paused', async ($, on) => {
  const clock = engine(on)
  await startJob($)
  await call($, PLAN, { steps: ['Read the notes', 'Write the page'] })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' })
  const meterOf = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /^\s*Paused$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Working/ })).toBeUndefined()
    const meter = (await ui.find({ type: 'Text', text: /^[█░]+$/ }))?.text
    await ui.unmount()

    return meter
  }
  const before = await meterOf()
  await clock.advance(1000)
  expect(await meterOf()).toBe(before)
})

test('/clear sets the mod up again once the new session has started', async ($, on) => {
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  const clock = engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  registered.length = 0
  await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } })
  expect(registered).not.toContain('minimal')
  await clock.advance(500)
  expect(registered).toContain('minimal')
})
