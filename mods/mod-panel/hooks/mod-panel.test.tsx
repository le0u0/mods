import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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

const runs: string[] = []
const panes: string[] = []

// A mod's value is undefined when it is installed but was never switched.
function engine(on: On, installed: { minimalView?: boolean | null; contextTracker?: boolean | null }) {
  runs.length = 0
  panes.length = 0
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
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
    ] as never,
  }))
  on('state.get', ($, e, next) => {
    if (e.plugin === 'mod-panel') {
      return next(e)
    }
    if (e.plugin === 'context-tracker' && e.key === 'usage') {
      return { value: { value: USAGE, version: 1 } }
    }
    const value = (e.plugin === 'minimal-view' ? installed.minimalView : installed.contextTracker) ?? undefined

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
  expect(toggle?.props.hotkey).toBe('1')
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

test('the Context Tracker row opens to show the context window', async ($, on) => {
  engine(on, { contextTracker: false })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE as never)
  expect(await ui.find({ type: 'Text', text: /compacts at 967k/ })).toBeUndefined()
  await ui.press({ key: 'open-context-tracker' })
  expect(await ui.find({ type: 'Text', text: /compacts at 967k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'tools ' })).toBeDefined()
  await ui.press({ key: 'open-context-tracker' })
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
  expect(await ui.find({ type: 'Text', text: /simple checklist/ })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 26 } } as never)
  expect(await ui.find({ type: 'Text', text: /simple checklist/ })).toBeUndefined()
  expect(await ui.find({ key: 'toggle-minimal-view' })).toBeDefined()
  await ui.unmount()
})
