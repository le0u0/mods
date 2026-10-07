import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { ModPanelMod, ModPanelUsage } from '../types'

type $ = EngineInterface

const PANE = 'mods'
const PANE_TITLE = 'Mods'
// Wide enough for a row's name, hint and switch when the pane docks beside the transcript.
const DOCK_COLUMNS = 64
// Cells of a row's switch as the terminal draws it, `[ ● On  ]`.
const SWITCH_WIDTH = 10
// The engine action the button answers: the chord the person binds to it presses
// the button from the prompt, so no command runs and nothing shows in the transcript.
const SHORTCUT_ACTION = 'app:toggleReplTab'

const openAtom = atom({ plugin: 'mod-panel', key: 'isOpen' } as const, false)
const installedAtom = atom({ plugin: 'mod-panel', key: 'installed' } as const, [])
const switchAtom = atom({ plugin: 'mod-panel', key: 'switch' } as const, null)
const openRowAtom = atom({ plugin: 'mod-panel', key: 'openRow' } as const, null)

const minimalViewEnabled = { plugin: 'minimal-view', key: 'minimalViewEnabled' } as const
const contextTrackerShown = { plugin: 'context-tracker', key: 'isShown' } as const
const contextTrackerUsage = { plugin: 'context-tracker', key: 'usage' } as const

const FREE_COLOR = '#3a3f4b'

type Mod = ModPanelMod

// Every mod the panel controls. A mod counts as installed once its command is
// registered; its value reads undefined until it is first switched, which is on.
// Each mod hooks `state.set` on mod-panel's `switch` to be turned on or off.
const MODS: readonly Mod[] = [
  {
    id: 'minimal-view',
    name: 'Minimal View',
    hint: 'simple checklist',
    command: 'minimal',
  },
  {
    id: 'context-tracker',
    name: 'Context Tracker',
    hint: 'context window usage',
    command: 'context-tracker',
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
  await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true, columns: DOCK_COLUMNS })
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

// The mod owns its value, so the panel writes a request the mod hooks and acts on.
async function setMod($: $, mod: Mod, isOn: boolean): Promise<void> {
  await update($, switchAtom, () => ({ mod: mod.id, isOn }))
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return `${tokens}`
  }
  if (tokens < 1_000_000) {
    return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  }

  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

// Cells of the bar for each used row, the rest free; every used row gets at least one.
export function barCells(usage: ModPanelUsage, width: number): { color: string; cells: number }[] {
  const max = Math.max(1, usage.maxTokens)
  const segments = usage.rows
    .filter(row => row.kind === 'used' && row.tokens > 0)
    .map(row => ({ color: row.color, cells: Math.max(1, Math.round((row.tokens / max) * width)) }))
  let used = segments.reduce((sum, segment) => sum + segment.cells, 0)
  while (used > width) {
    const widest = segments.reduce((a, b) => (b.cells > a.cells ? b : a))
    widest.cells -= 1
    used -= 1
  }

  return [...segments, { color: FREE_COLOR, cells: width - used }]
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

  // /mods prints no output row; the engine still echoes the command itself.
  on('ui.render', { component: 'CommandOutput', props: { command: 'mods' } }, async () => <></>)


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
        <Button key="open-mods" label={isOpen ? 'Mods ▴' : 'Mods ▾'} action={SHORTCUT_ACTION} onPress={() => togglePanel($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const mods = await installedMods($)
    const nameWidth = Math.max(0, ...mods.map(mod => mod.name.length)) + 4
    const hintWidth = Math.max(0, ...mods.map(mod => mod.hint.length)) + 2
    // A docked pane can be narrow: past the room for a hint, rows leave it out.
    const hasHints = e.props.bodyColumns >= 2 + nameWidth + hintWidth + SWITCH_WIDTH

    const states: Record<Mod['id'], boolean> = {
      'minimal-view': (await $.state.get(minimalViewEnabled)).value ?? true,
      'context-tracker': (await $.state.get(contextTrackerShown)).value ?? true,
    }
    const openRow = await read($, openRowAtom)
    const usage = openRow === 'context-tracker' ? (await $.state.get(contextTrackerUsage)).value ?? null : null
    // The pane's body, less the details' indent.
    const width = Math.max(10, e.props.bodyColumns - 2)

    const details = (mod: Mod) => {
      if (mod.id !== 'context-tracker') {
        return null
      }
      if (usage === null) {
        return <Text dimColor>  Measuring the context window…</Text>
      }
      const compacts = usage.compactAt === null ? '' : ` · compacts at ${formatTokens(usage.compactAt)}`

      return (
        <Box key="details-context-tracker" flexDirection="column" paddingLeft={2}>
          <Text>
            <Text bold>{formatTokens(usage.totalTokens)}</Text>
            <Text dimColor> of {formatTokens(usage.maxTokens)} · {Math.round(usage.percent)}%{compacts}</Text>
          </Text>
          <Text>
            {barCells(usage, width).map((segment, index) => (
              <Text key={`cell-${index}`} color={segment.color}>{'█'.repeat(segment.cells)}</Text>
            ))}
          </Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {usage.rows.filter(row => row.kind !== 'buffer').map(row => (
              <Text key={`legend-${row.name}`}>
                <Text color={row.kind === 'free' ? FREE_COLOR : row.color}>■ </Text>
                <Text>{row.name} </Text>
                <Text bold>{formatTokens(row.tokens)}</Text>
              </Text>
            ))}
          </Box>
        </Box>
      )
    }

    const rows = mods.map((mod, index) => {
      const isOn = states[mod.id]
      const isOpen = openRow === mod.id
      const canOpen = mod.id === 'context-tracker'

      return (
        <Box key={`mod-${mod.id}`} flexDirection="column">
          <Box key={`row-${mod.id}`} flexDirection="row">
            {isOn ? <Text color="success">● </Text> : <Text dimColor>○ </Text>}
            {canOpen
              ? (
                  <Button
                    key={`open-${mod.id}`}
                    plain
                    label={`${mod.name} ${isOpen ? '▾' : '▸'}`.padEnd(nameWidth)}
                    onPress={() => update($, openRowAtom, row => (row === mod.id ? null : mod.id))}
                  />
                )
              : <Text bold={isOn}>{mod.name.padEnd(nameWidth)}</Text>}
            {hasHints && <Text dimColor>{mod.hint.padEnd(hintWidth)}</Text>}
            <Button
              key={`toggle-${mod.id}`}
              label={isOn ? '● On ' : '○ Off'}
              variant={isOn ? 'primary' : 'secondary'}
              hotkey={index < 9 ? String(index + 1) : undefined}
              autoFocus={index === 0 ? true : undefined}
              onPress={() => setMod($, mod, !isOn)}
            />
          </Box>
          {isOpen && details(mod)}
        </Box>
      )
    })

    return (
      <Box flexDirection="column">
        <Text dimColor>Mods</Text>
        <Text> </Text>
        {rows}
        <Text> </Text>
        <Text dimColor>↑↓ or tab to move · enter to press · 1-{mods.length} to switch · esc to close</Text>
      </Box>
    )
  })
}
