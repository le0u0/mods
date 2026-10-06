import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionContextBreakdown } from 'claude-code'

import { barCells, formatTokens, toUsage } from './context-bar'

const BAND = {
  plugin: 'context-bar',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const BREAKDOWN: SessionContextBreakdown = {
  categories: [
    { name: 'System prompt', tokens: 4200, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 52000, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'MCP server instructions', tokens: 1200, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 33800, color: 'claude', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 897000, color: 'inactive', isDeferred: false, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 13000, color: 'inactive', isDeferred: false, kind: 'buffer' },
  ],
  totalTokens: 90000,
  maxTokens: 1000000,
  rawMaxTokens: 1000000,
  autocompactSource: 'model-default',
  percentage: 9,
  gridRows: [],
  model: 'claude-opus-5-5',
  memoryFiles: [{ path: '/Users/me/.claude/CLAUDE.md', type: 'User', tokens: 496 }],
  mcpTools: [
    { name: 'mcp__docs__read', serverName: 'docs', tokens: 500, isLoaded: true },
    { name: 'mcp__docs__write', serverName: 'docs', tokens: 300, isLoaded: true },
    { name: 'mcp__jira__search', serverName: 'jira', tokens: 900, isLoaded: false },
  ],
  agents: [],
  autoCompactThreshold: 987000,
  isAutoCompactEnabled: true,
  apiUsage: null,
}

let totalTokens = 90000

function engine(on: On, breakdown: SessionContextBreakdown = BREAKDOWN) {
  totalTokens = 90000
  mock.clock(on)
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('session.usage', ($, e) => ({
    value: { startedAt: 0, rateLimits: [], context: { tokens: totalTokens, window: 1000000, percent: 9, breakdown: e.breakdown === undefined ? undefined : { ...breakdown, totalTokens } } },
  }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.component === 'SessionMode' ? e.props.modes.join(' & ') : 'engine row'}</Text>
  })
}

test('tokens are written short', () => {
  expect(formatTokens(512)).toBe('512')
  expect(formatTokens(4200)).toBe('4.2k')
  expect(formatTokens(52000)).toBe('52k')
  expect(formatTokens(1000000)).toBe('1M')
})

test('the bar fills its width and keeps the buffer out of the legend', () => {
  const usage = toUsage(BREAKDOWN)
  expect(usage.rows.map(row => row.name)).toEqual(['mcp', 'messages', 'system prompt', 'free'])
  expect(usage.rows[0]!.tokens).toBe(53200)
  expect(usage.compactAt).toBe(987000)
  const cells = barCells(usage, 50)
  expect(cells.reduce((sum, segment) => sum + segment.cells, 0)).toBe(50)
  expect(cells.at(-2)!.cells).toBe(1)
  expect(new Set(usage.rows.map(row => row.color)).size).toBe(4)
})

test('the band shows the window and each category above the prompt', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /compacts at 987k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 9% / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^mcp $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
    if (surface === 'desktop') {
      expect(await ui.find({ type: 'Svg' })).toBeDefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('/context-bar hides and shows the band', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(await $.command.run({ command: 'context-bar', args: '' } as never)).toMatchObject({ text: 'Context bar hidden.' })
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /compacts at/ })).toBeUndefined()
  await ui.unmount()
  expect(await $.command.run({ command: 'context-bar', args: 'on' } as never)).toMatchObject({ text: 'Context bar shown.' })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /compacts at/ })).toBeDefined()
  await ui.unmount()
})

test('the MCP row lists loaded tools by server', () => {
  const mcp = toUsage(BREAKDOWN).rows.find(row => row.name === 'mcp')!
  expect(mcp.items).toEqual([{ name: 'docs', tokens: 800 }])
})

test('the arrow collapses the card and a row arrow opens its list', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'open-mcp' })
  expect(await ui.find({ type: 'Text', text: 'docs' })).toBeDefined()
  await ui.press({ key: 'collapse' })
  expect(await ui.find({ type: 'Text', text: /█/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'docs' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: / 9% / })).toBeDefined()
  await ui.unmount()
})

test('the header shows what this turn added', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  totalTokens = 93200
  await $.turn.complete({ answer: 'done' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: / \+3\.2k/ })).toBeDefined()
  await ui.unmount()
})

test('hidden, the prompt footer keeps the figures', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const footer = { plugin: 'context-bar', component: 'SessionMode', surface: 'terminal', props: { modes: ['focus'] } } as const
  await $.command.run({ command: 'context-bar', args: 'off' } as never)
  let ui = await $.ui.mount(footer)
  expect(await ui.find({ type: 'Text', text: '◆ context 90k · 9% & focus' })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'context-bar', args: 'on' } as never)
  ui = await $.ui.mount(footer)
  expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
  await ui.unmount()
})

test('a long list shows 10 and each press shows 10 more', async ($, on) => {
  const skills = Array.from({ length: 25 }, (_, index) => ({ name: `skill-${index}`, source: 'user', tokens: 1000 - index }))
  engine(on, {
    ...BREAKDOWN,
    categories: [...BREAKDOWN.categories, { name: 'Skills', tokens: 24700, color: 'claude', isDeferred: false, kind: 'used' }],
    skills: { totalSkills: 25, includedSkills: 25, tokens: 24700, skillFrontmatter: skills },
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'open-skills' })
  expect(await ui.find({ type: 'Text', text: 'skill-9' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'skill-10' })).toBeUndefined()
  await ui.press({ key: 'more' })
  expect(await ui.find({ type: 'Text', text: 'skill-19' })).toBeDefined()
  await ui.press({ key: 'more' })
  expect(await ui.find({ type: 'Text', text: 'skill-24' })).toBeDefined()
  expect(await ui.find({ key: 'more' })).toBeUndefined()
  await ui.press({ key: 'less' })
  expect(await ui.find({ type: 'Text', text: 'skill-10' })).toBeUndefined()
  await ui.unmount()
})
