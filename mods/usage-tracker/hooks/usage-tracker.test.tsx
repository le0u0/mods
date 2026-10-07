import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

import { formatPercent, requestDelta, sessionPercent, toLimits } from './usage-tracker'

const FOOTER = { plugin: 'usage-tracker', component: 'SessionMode', surface: 'terminal', props: { modes: ['focus'] } } as const

let rateLimits: SessionRateLimit[] = []
let clock: ReturnType<typeof mock.clock>

// Every command the mod registered, in order.
const registered: string[] = []

function engine(on: On) {
  rateLimits = [
    { kind: 'five_hour', percentUsed: 57, resetsAt: '2026-10-07T04:50:00Z' },
    { kind: 'seven_day', percentUsed: 60, resetsAt: '2026-10-10T12:00:00Z' },
  ]
  mock.store(on)
  clock = mock.clock(on)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => (registered.push(e.name), { value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits, context: { tokens: 0, window: 1000000, percent: 0 } } as never }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.component === 'SessionMode' ? e.props.modes.join(' & ') : 'engine row'}</Text>
  })
}

async function measure($: Parameters<TestBody>[0], percent: number) {
  rateLimits = [{ kind: 'five_hour', percentUsed: percent }]
  await $.session.measure({ context: { tokens: 0, window: 1000000, percent: 0 }, rateLimits, changed: ['rateLimits'] } as never)
}

// One request: it starts, the window moves to `percent`, it ends, and its share settles.
async function request($: Parameters<TestBody>[0], percent: number) {
  await $.turn.start({ text: 'hi', turnId: 't' })
  await measure($, percent)
  await $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await clock.advance(3000)
}

test('percents keep one decimal at most', () => {
  expect(formatPercent(57)).toBe('57%')
  expect(formatPercent(1.5)).toBe('1.5%')
  expect(formatPercent(1.04)).toBe('1%')
  expect(sessionPercent(toLimits([{ kind: 'seven_day', percentUsed: 60 }]))).toBe(null)
  expect(requestDelta(57, 58.5)).toBe(1.5)
  expect(requestDelta(98, 2)).toBe(2)
})

test('the footer shows the session use, then what the last request took', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  let ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ type: 'Text', text: '57%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
  await ui.unmount()

  await request($, 58.5)
  ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ type: 'Text', text: '58.5%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · last +1.5%' })).toBeDefined()
  await ui.unmount()

  // While idle, another session using the window moves the figure but not the last request's share.
  await measure($, 60)
  ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ type: 'Text', text: '60%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · last +1.5%' })).toBeDefined()
  await ui.unmount()

  // A request the window does not move shows +0%, not the one before it.
  await request($, 60)
  ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ type: 'Text', text: ' · last +0%' })).toBeDefined()
  await ui.unmount()
})

test('/usage-tracker off hides the footer figures', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(await $.command.run({ command: 'usage-tracker', args: 'off' } as never)).toMatchObject({ text: 'Usage tracker hidden.' })
  const ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ type: 'Text', text: '57%' })).toBeUndefined()
  await ui.unmount()
})

test('without plan limits the footer shows nothing of its own', async ($, on) => {
  engine(on)
  rateLimits = []
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ type: 'Text', text: /usage/ })).toBeUndefined()
  await ui.unmount()
})

test('/clear sets the mod up again in the new session', async ($, on) => {
  on('classic.SessionStart', () => ({}))
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  registered.length = 0
  await $.classic.SessionStart({ source: 'clear' })
  expect(registered).toContain('usage-tracker')
})
