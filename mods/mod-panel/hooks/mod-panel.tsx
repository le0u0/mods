import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { ModPanelMod } from '../types'

type $ = EngineInterface

const PANE = 'mods'
const PANE_TITLE = 'Mods'

const openAtom = atom({ plugin: 'mod-panel', key: 'isOpen' } as const, false)
const installedAtom = atom({ plugin: 'mod-panel', key: 'installed' } as const, [])

const minimalViewEnabled = { plugin: 'minimal-view', key: 'minimalViewEnabled' } as const
const contextBarShown = { plugin: 'context-bar', key: 'isShown' } as const

type Mod = ModPanelMod

// Every mod the panel controls. A mod counts as installed once its command is
// registered; its value reads undefined until it is first switched, which is on.
const MODS: readonly Mod[] = [
  {
    id: 'minimal-view',
    name: 'Minimal View',
    hint: 'simple checklist',
    command: 'minimal',
  },
  {
    id: 'context-bar',
    name: 'Context Bar',
    hint: 'context window usage',
    command: 'context-bar',
  },
]

async function installedMods($: $): Promise<Mod[]> {
  const installed = await read($, installedAtom)

  return MODS.filter(mod => installed.includes(mod.id))
}

async function markInstalled($: $, commands: readonly string[]): Promise<void> {
  const found = MODS.filter(mod => commands.includes(mod.command)).map(mod => mod.id)
  if (found.length > 0) {
    await update($, installedAtom, ids => [...new Set([...ids, ...found])])
  }
}

async function openPanel($: $): Promise<void> {
  await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true })
  await update($, openAtom, () => true)
}

async function togglePanel($: $): Promise<void> {
  if (await read($, openAtom)) {
    await $.ui.close({ id: PANE })
    await update($, openAtom, () => false)
  } else {
    await openPanel($)
  }
}

// The mod owns its value, so the panel asks it to switch through its command.
async function setMod($: $, mod: Mod, isOn: boolean): Promise<void> {
  try {
    await $.command.run({ command: mod.command, args: isOn ? 'on' : 'off' } as never)
  } catch {
    $.ui.toast(`Couldn't switch ${mod.name}. Try /${mod.command} ${isOn ? 'on' : 'off'}.`)
  }
}

export function registerModPanel(on: On): void {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await markInstalled($, (await $.command.list()).map(command => command.name))
    await $.command.register({
      name: 'mods',
      description: 'Open or close the panel that turns each mod on or off',
    })

    return result
  })

  // A mod registers its command as it starts, which may be after this plugin.
  on('command.register', async ($, e, next) => {
    const result = await next(e)
    await markInstalled($, [e.name])

    return result
  })

  on('command.run', { command: 'mods' }, async $ => {
    await togglePanel($)

    return { text: (await read($, openAtom)) ? 'Mods panel opened.' : 'Mods panel closed.' }
  })

  // Esc or the pane's own close; a close of this plugin's own skips this hook.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    await update($, openAtom, () => false)

    return result
  })

  // The button sits after the mode labels, on the row with the permission mode.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if ((await installedMods($)).length === 0) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const isOpen = await read($, openAtom)
    const modes = await next(e)

    return (
      <Box flexDirection="row">
        {modes}
        {e.props.modes.length > 0 && <Text> </Text>}
        <Button key="open-mods" label={isOpen ? 'Mods ▴' : 'Mods ▾'} onPress={() => togglePanel($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const mods = await installedMods($)
    const nameWidth = Math.max(0, ...mods.map(mod => mod.name.length)) + 2
    const hintWidth = Math.max(0, ...mods.map(mod => mod.hint.length)) + 2

    const states: Record<Mod['id'], boolean> = {
      'minimal-view': (await $.state.get(minimalViewEnabled)).value ?? true,
      'context-bar': (await $.state.get(contextBarShown)).value ?? true,
    }

    const rows = mods.map((mod, index) => {
      const isOn = states[mod.id]

      return (
        <Box key={`row-${mod.id}`} flexDirection="row">
          {isOn ? <Text color="success">● </Text> : <Text dimColor>○ </Text>}
          <Text bold={isOn}>{mod.name.padEnd(nameWidth)}</Text>
          <Text dimColor>{mod.hint.padEnd(hintWidth)}</Text>
          <Button
            key={`toggle-${mod.id}`}
            label={isOn ? '● On ' : '○ Off'}
            variant={isOn ? 'primary' : 'secondary'}
            hotkey={index < 9 ? String(index + 1) : undefined}
            autoFocus={index === 0 ? true : undefined}
            onPress={() => setMod($, mod, !isOn)}
          />
        </Box>
      )
    })

    return (
      <Box flexDirection="column">
        <Text dimColor>Mods</Text>
        <Text> </Text>
        {rows}
        <Text> </Text>
        <Text dimColor>↑↓ or tab to move · enter or 1-{mods.length} to switch · esc to close</Text>
      </Box>
    )
  })
}
