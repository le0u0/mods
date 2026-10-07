import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const FOOTER = { plugin: 'mod-panel', component: 'SessionMode', surface: 'terminal', props: { modes: ['focus'] } } as const

const PANE = { plugin: 'mod-panel', component: 'Pane', surface: 'terminal', requestId: 'mods', props: {} } as const

const runs: string[] = []
const panes: string[] = []

// A mod's value is undefined when it is installed but was never switched.
function engine(on: On, installed: { minimalView?: boolean | null; contextBar?: boolean | null }) {
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
  on('command.run', ($, e) => {
    runs.push(`/${e.command} ${e.args}`)

    return { text: 'ran' }
  })
  on('command.list', () => ({
    value: [
      ...(installed.minimalView === undefined ? [] : [{ name: 'minimal' }]),
      ...(installed.contextBar === undefined ? [] : [{ name: 'context-bar' }]),
    ] as never,
  }))
  on('state.get', ($, e, next) => {
    if (e.plugin === 'mod-panel') {
      return next(e)
    }
    const value = (e.plugin === 'minimal-view' ? installed.minimalView : installed.contextBar) ?? undefined

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
  expect(await ui.find({ key: 'toggle-context-bar' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Context Bar/ })).toBeUndefined()
  await ui.unmount()
})

test('a switch runs the mod command to flip it', async ($, on) => {
  engine(on, { minimalView: true, contextBar: false })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE as never)
  await ui.press({ key: 'toggle-minimal-view' })
  await ui.press({ key: 'toggle-context-bar' })
  expect(runs).toEqual(['/minimal off', '/context-bar on'])
  await ui.unmount()
})
