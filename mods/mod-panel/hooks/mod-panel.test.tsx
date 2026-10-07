import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { formatReset, limitBar, limitName, paneRows, wrappedRows } from './mod-panel'

const FOOTER = { plugin: 'mod-panel', component: 'SessionMode', surface: 'terminal', props: { modes: ['focus'] } } as const

const PANE = { plugin: 'mod-panel', component: 'Pane', surface: 'terminal', requestId: 'mods', props: { title: 'Mods', isFocused: true, bodyColumns: 76 } } as const

const USAGE = {
  rows: [
    { name: 'tools', tokens: 27000, color: '#6fb3c0', kind: 'used' },
    { name: 'messages', tokens: 7400, color: '#d9825b', kind: 'used' },
    { name: 'free', tokens: 919000, color: '#3a3f4b', kind: 'free' },
  ],
  totalTokens: 48000,
  maxTokens: 1000000,
  percent: 5,
  compactAt: 967000,
} as const

const LIMITS = [
  { kind: 'five_hour', percentUsed: 57, resetsAt: null },
  { kind: 'seven_day', percentUsed: 60.5, resetsAt: null },
]

const runs: string[] = []
const panes: string[] = []

// A mod's value is undefined when it is installed but was never switched.
let clock: ReturnType<typeof mock.clock>
// Every command the mod registered, in order.
const registered: string[] = []

function engine(on: On, installed: { minimalView?: boolean | null; contextTracker?: boolean | null; usageTracker?: boolean | null }) {
  runs.length = 0
  panes.length = 0
  mock.store(on)
  clock = mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => (registered.push(e.name), { value: { command: e.name } }))
  on('ui.open', ($, e) => {
    panes.push(`open ${e.id}`)

    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    panes.push(`close ${e.id}`)

    return { value: undefined }
  })
  on('state.set', ($, e, next) => {
    if (e.plugin === 'mod-panel' && e.key === 'switch') {
      runs.push(JSON.stringify(e.value))
    }

    return next(e)
  })
  on('command.list', () => ({
    value: [
      ...(installed.minimalView === undefined ? [] : [{ name: 'minimal' }]),
      ...(installed.contextTracker === undefined ? [] : [{ name: 'context-tracker' }]),
      ...(installed.usageTracker === undefined ? [] : [{ name: 'usage-tracker' }]),
    ] as never,
  }))
  on('state.get', ($, e, next) => {
    if (e.plugin === 'mod-panel') {
      return next(e)
    }
    if (e.plugin === 'context-tracker' && e.key === 'usage') {
      return { value: { value: USAGE, version: 1 } }
    }
    if (e.plugin === 'usage-tracker' && e.key === 'limits') {
      return { value: { value: LIMITS, version: 1 } }
    }
    const value = (e.plugin === 'minimal-view' ? installed.minimalView : e.plugin === 'context-tracker' ? installed.contextTracker : installed.usageTracker) ?? undefined

    return { value: { value, version: value === undefined ? 0 : 1 } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })
}

test('with no mod installed the footer has no button', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ key: 'open-mods' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
  await ui.unmount()
})

test('the footer button opens the panel and a second press closes it', async ($, on) => {
  engine(on, { minimalView: true })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
  expect((await ui.find({ key: 'open-mods' }))?.props.label).toBe('Mods ▾')
  await ui.press({ key: 'open-mods' })
  expect(panes).toEqual(['open mods'])
  expect((await ui.find({ key: 'open-mods' }))?.props.label).toBe('Mods ▴')
  await ui.press({ key: 'open-mods' })
  expect((await ui.find({ key: 'open-mods' }))?.props.label).toBe('Mods ▾')
  expect(panes).toEqual(['open mods', 'close mods'])
  await ui.unmount()
})

test('the panel lists only installed mods, on until switched off', async ($, on) => {
  engine(on, { minimalView: null })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE as never)
  const toggle = await ui.find({ key: 'toggle-minimal-view' })
  expect(toggle?.props.label).toBe('● On ')
  expect((await ui.find({ key: 'hot-minimal-view' }))?.props.hotkey).toBe('1')
  expect(await ui.find({ type: 'Text', text: /1:/ })).toBeUndefined()
  expect(await ui.find({ key: 'toggle-context-tracker' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Context Tracker/ })).toBeUndefined()
  await ui.unmount()
})

test('a switch asks the mod to turn itself on or off', async ($, on) => {
  engine(on, { minimalView: true, contextTracker: false })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE as never)
  await ui.press({ key: 'toggle-minimal-view' })
  await ui.press({ key: 'toggle-context-tracker' })
  expect(runs).toEqual(['{"mod":"minimal-view","isOn":false}', '{"mod":"context-tracker","isOn":true}'])
  await ui.unmount()
})

test('the Context Tracker page shows the context window', async ($, on) => {
  engine(on, { contextTracker: false })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE as never)
  expect(await ui.find({ type: 'Text', text: /compacts at 967k/ })).toBeUndefined()
  await ui.press({ key: 'page-context-tracker' })
  expect(await ui.find({ type: 'Text', text: /compacts at 967k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'tools ' })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: /compacts at 967k/ })).toBeUndefined()
  await ui.unmount()
})

test('/mods prints no output row', async ($, on) => {
  engine(on, { minimalView: true })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const output = await $.ui.mount({ plugin: 'mod-panel', surface: 'terminal', component: 'CommandOutput', props: { command: 'mods', args: '', text: 'Mods panel opened.', isErrored: false } } as never)
  expect(await output.find({ type: 'Text' })).toBeUndefined()
  await output.unmount()
})

test('a narrow pane leaves the hints out', async ($, on) => {
  engine(on, { minimalView: true })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  let ui = await $.ui.mount(PANE as never)
  expect(await ui.find({ type: 'Text', text: /plan, no tool calls/ })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 26 } } as never)
  expect(await ui.find({ type: 'Text', text: /plan, no tool calls/ })).toBeUndefined()
  expect(await ui.find({ key: 'toggle-minimal-view' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /esc to close/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /esc close/ })).toBeDefined()
  await ui.unmount()
})

test('the Usage Tracker page shows each usage limit', async ($, on) => {
  engine(on, { usageTracker: false })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE as never)
  await ui.press({ key: 'page-usage-tracker' })
  expect(await ui.find({ type: 'Text', text: 'Session · 5 hours' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Week · all models' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '57% used' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '61% used' })).toBeDefined()
  await ui.unmount()
})

test('usage-limit bars and reset times read as /usage draws them', () => {
  expect(limitBar(57, 50)).toEqual({ full: 28, partial: '▌', rest: 21 })
  expect(limitBar(100, 10)).toEqual({ full: 10, partial: '', rest: 0 })
  expect(limitName('five_hour')).toBe('Session · 5 hours')
  expect(limitName('weekly_cap')).toBe('Weekly cap')
  const now = Date.parse('2026-10-07T01:00:00Z')
  expect(formatReset('2026-10-07T04:50:00Z', now, 'Asia/Hong_Kong')).toBe('12:50pm')
  expect(formatReset('2026-10-10T12:00:00Z', now, 'Asia/Hong_Kong')).toBe('Oct 10, 8pm')
})

test('a number opens the mod page and q goes back to the list', async ($, on) => {
  engine(on, { minimalView: true, contextTracker: true })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE as never)
  await ui.press({ key: 'page-context-tracker' })
  expect(await ui.find({ type: 'Text', text: /context window is, by category/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /compacts at 967k/ })).toBeDefined()
  expect(await ui.find({ key: 'toggle-context-tracker' })).toBeDefined()
  expect((await ui.find({ key: 'hot-back' }))?.props.hotkey).toBe('q')
  expect(await ui.find({ key: 'toggle-context-tracker' })).toBeDefined()
  expect(await ui.find({ key: 'page-minimal-view' })).toBeUndefined()
  await ui.press({ key: 'hot-back' })
  expect(await ui.find({ key: 'page-minimal-view' })).toBeDefined()
  await ui.unmount()
})

test('the pane asks for the rows its wrapped text and details take', () => {
  const mod = { id: 'usage-tracker', name: 'Usage Tracker', hint: 'plan usage limits', about: 'x'.repeat(100), command: 'usage-tracker' } as const
  const data = { limits: [], usage: null, now: 0, timeZone: 'UTC' }
  expect(wrappedRows('x'.repeat(100), 60)).toBe(2)
  const three = [1, 2, 3].map(index => ({ kind: `k${index}`, percentUsed: 10, resetsAt: null }))
  // The 100-character text takes two rows at 60 columns, one at 120.
  expect(paneRows([mod], mod, 60, { ...data, limits: three.slice(0, 2) })).toBe(paneRows([mod], mod, 120, { ...data, limits: three.slice(0, 2) }) + 1)
  // Three limits fit two to a row at 60 columns: two rows of three lines.
  expect(paneRows([mod], mod, 60, { ...data, limits: three }) - paneRows([mod], mod, 60, { ...data, limits: three.slice(0, 2) })).toBe(3)
})

test('/clear sets the mod up again once the new session has started', async ($, on) => {
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  engine(on, {})
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  registered.length = 0
  await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } })
  expect(registered).not.toContain('mods')
  await clock.advance(500)
  expect(registered).toContain('mods')
})

test('after a /clear empties its values the footer still has the button', async ($, on) => {
  // Before the mod sets itself up again, the commands it reads are still registered.
  engine(on, { contextTracker: true })
  const ui = await $.ui.mount(FOOTER)
  expect((await ui.find({ key: 'open-mods' }))?.props.label).toBe('Mods ▾')
  await ui.unmount()
})
