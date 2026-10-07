import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { ModPanelLimit, ModPanelMod, ModPanelUsage } from '../types'

type $ = EngineInterface
// How long after a /clear's `session.end` the new session has emptied this mod's values.
const CLEAR_SETTLE_MS = 500

const PANE = 'mods'
const PANE_TITLE = 'Mods'
// Wide enough for a row's name, hint and switch when the pane docks beside the transcript.
const DOCK_COLUMNS = 64
// Cells of a row's switch as the terminal draws it, `[ ● On  ]`.
const SWITCH_WIDTH = 10
// The engine action the button answers: the chord the person binds to it presses
// the button from the prompt, so no command runs and nothing shows in the transcript.
const SHORTCUT_ACTION = 'app:toggleReplTab'
// A pane's Button takes a digit or a letter as its key, so Back is `q`.
const BACK_KEY = 'q'
const FOCUS_DELAY_MS = 50
const FOCUS_TRIES = 5

const openAtom = atom({ plugin: 'mod-panel', key: 'isOpen' } as const, false)
const installedAtom = atom({ plugin: 'mod-panel', key: 'installed' } as const, [])
const switchAtom = atom({ plugin: 'mod-panel', key: 'switch' } as const, null)
const pageAtom = atom({ plugin: 'mod-panel', key: 'page' } as const, null)

const minimalViewEnabled = { plugin: 'minimal-view', key: 'minimalViewEnabled' } as const
const contextTrackerShown = { plugin: 'context-tracker', key: 'isShown' } as const
const contextTrackerUsage = { plugin: 'context-tracker', key: 'usage' } as const
const usageTrackerShown = { plugin: 'usage-tracker', key: 'isShown' } as const
const usageTrackerLimits = { plugin: 'usage-tracker', key: 'limits' } as const

const FREE_COLOR = '#3a3f4b'

type Mod = ModPanelMod

// Every mod the panel controls. A mod counts as installed once its command is
// registered; its value reads undefined until it is first switched, which is on.
// Each mod hooks `state.set` on mod-panel's `switch` to be turned on or off.
const MODS: readonly Mod[] = [
  {
    id: 'minimal-view',
    name: 'Minimal View',
    hint: 'plan, no tool calls',
    about: "Hides Claude's tool calls and shows its plan as plain steps above the chatbox, with each step's progress.",
    command: 'minimal',
  },
  {
    id: 'context-tracker',
    name: 'Context Tracker',
    hint: 'context window usage',
    about: 'Shows how full the context window is, by category. Folded, its percent sits in the footer.',
    command: 'context-tracker',
  },
  {
    id: 'usage-tracker',
    name: 'Usage Tracker',
    hint: 'plan usage limits',
    about: "Shows how much of your plan's usage limits is used, and what the last request took.",
    command: 'usage-tracker',
  },
]

// The keys lines at the foot of the list and of a mod's page.
const LIST_KEYS = (count: number) => `↑↓ to move · space to open · 1-${count} to open a mod · esc to close`
// The keys line a narrow pane shows, so it does not wrap.
const SHORT_LIST_KEYS = (count: number) => `1-${count} open · esc close`
const PAGE_KEYS = 'space to press · q to go back · esc to close'
const NO_LIMITS = "No usage limits yet. They show after Claude's first reply on a Claude plan."
// Usage limits sit side by side, each column this wide at least, this far apart.
const LIMIT_COLUMN = 24
const LIMIT_GAP = 4
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const LIMIT_NAMES: Record<string, string> = {
  five_hour: 'Session · 5 hours',
  seven_day: 'Week · all models',
  seven_day_opus: 'Week · Opus',
  seven_day_sonnet: 'Week · Sonnet',
  spend_limit: 'Spend limit',
}

// The command list is read too: a /clear empties this plugin's values but keeps every command,
// so no `command.register` follows, and the engine skips a user plugin's `classic.SessionStart`.
async function installedMods($: $): Promise<Mod[]> {
  const installed = await read($, installedAtom)
  const commands = (await $.command.list()).map(command => command.name)

  return MODS.filter(mod => installed.includes(mod.id) || commands.includes(mod.command))
}

async function markInstalled($: $, commands: readonly string[]): Promise<void> {
  const found = MODS.filter(mod => commands.includes(mod.command)).map(mod => mod.id)
  if (found.length > 0) {
    await update($, installedAtom, ids => [...new Set([...ids, ...found])])
  }
}

// Asks for as many rows as the panel's content takes; opening an open pane resizes it.
async function openPanel($: $): Promise<void> {
  const mods = await installedMods($)
  const page = await read($, pageAtom)
  const rows = paneRows(mods, mods.find(mod => mod.id === page) ?? null, paneColumns, {
    limits: page === 'usage-tracker' ? (await $.state.get(usageTrackerLimits)).value ?? [] : [],
    usage: page === 'context-tracker' ? (await $.state.get(contextTrackerUsage)).value ?? null : null,
    now: await $.clock.now(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true, columns: DOCK_COLUMNS, rows })
  await update($, openAtom, () => true)
}

// A mod's page shows its switch, what it does and its details; Back returns to the list.
// The ring lands on the page's switch, and back on the mod's name in the list.
async function showPage($: $, id: Mod['id'] | null): Promise<void> {
  const from = await read($, pageAtom)
  await update($, pageAtom, () => id)
  await openPanel($)
  const key = id !== null ? `toggle-${id}` : from !== null ? `page-${from}` : null
  if (key !== null) {
    // After the press that changed page settles: the engine drops the ring with the pressed button.
    focusSoon($, key, FOCUS_TRIES)
  }
}

// Moves the ring once the press that changed page has settled, trying again while the new page
// is still being drawn. The engine skips this plugin's own ui.focus hook for its own move, so note it here.
function focusSoon($: $, key: string, tries: number): void {
  $.clock.after(FOCUS_DELAY_MS, () => {
    void $.ui.focus({ requestId: PANE, key })
      .then(result => {
        if (result.deny === undefined) {
          focused = key
        } else if (tries > 1) {
          focusSoon($, key, tries - 1)
        }
      })
      .catch(() => {})
  })
}

async function togglePanel($: $): Promise<void> {
  if (await read($, openAtom)) {
    await $.ui.close({ id: PANE })
    await update($, openAtom, () => false)
  } else {
    focused = null
    await update($, pageAtom, () => null)
    await openPanel($)
  }
}

// The mod owns its value, so the panel writes a request the mod hooks and acts on.
async function setMod($: $, mod: Mod, isOn: boolean): Promise<void> {
  await update($, switchAtom, () => ({ mod: mod.id, isOn }))
}

export function limitName(kind: string): string {
  return LIMIT_NAMES[kind] ?? kind.replace(/_/g, ' ').replace(/^./, first => first.toUpperCase())
}

// Whole cells, then one eighth-cell for the rest, as /usage draws its bars, then the cells left free.
export function limitBar(percent: number, width: number): { full: number; partial: string; rest: number } {
  const eighths = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width * 8)
  const full = Math.floor(eighths / 8)
  const partial = EIGHTHS[eighths % 8] ?? ''

  return { full, partial, rest: width - full - partial.length }
}

// The list's keys line: the short one once the full one would wrap.
export function listKeys(count: number, width: number): string {
  return LIST_KEYS(count).length <= width ? LIST_KEYS(count) : SHORT_LIST_KEYS(count)
}

// Rows a line of text takes when it wraps at `width` cells.
export function wrappedRows(text: string, width: number): number {
  return Math.max(1, Math.ceil(text.length / Math.max(1, width)))
}

// How many usage limits sit side by side, and how wide each column is.
export function limitLayout(count: number, width: number): { perRow: number; columnWidth: number } {
  const fits = Math.max(1, Math.floor((width - 2 + LIMIT_GAP) / (LIMIT_COLUMN + LIMIT_GAP)))
  const perRow = Math.max(1, Math.min(count, fits))

  return { perRow, columnWidth: Math.max(LIMIT_COLUMN, Math.floor((width - 2 - LIMIT_GAP * (perRow - 1)) / perRow)) }
}

function limitLine(limit: ModPanelLimit, now: number, timeZone: string): string {
  const resets = limit.resetsAt === null ? '' : ` · resets ${formatReset(limit.resetsAt, now, timeZone)}`

  return `${Math.round(limit.percentUsed)}% used${resets}`
}

function legendItems(usage: ModPanelUsage): ModPanelUsage['rows'] {
  return usage.rows.filter(row => row.kind !== 'buffer')
}

// Rows the context legend takes as flex-wrap lays its items out, two cells apart.
export function legendRows(usage: ModPanelUsage, width: number): number {
  let rows = 1
  let used = 0
  for (const row of legendItems(usage)) {
    const cells = `■ ${row.name} ${formatTokens(row.tokens)}`.length
    if (used > 0 && used + 2 + cells > width) {
      rows += 1
      used = 0
    }
    used += (used > 0 ? 2 : 0) + cells
  }

  return rows
}

// Rows a mod's details take on its page at `width` cells, their gap below included.
export function detailRows(
  id: ModPanelMod['id'],
  width: number,
  data: { limits: readonly ModPanelLimit[]; usage: ModPanelUsage | null; now: number; timeZone: string },
): number {
  const inner = width - 2
  if (id === 'usage-tracker') {
    if (data.limits.length === 0) {
      return wrappedRows(NO_LIMITS, inner)
    }
    const { perRow, columnWidth } = limitLayout(data.limits.length, width)
    let rows = 0
    for (let at = 0; at < data.limits.length; at += perRow) {
      const line = Math.max(...data.limits.slice(at, at + perRow).map(limit => wrappedRows(limitLine(limit, data.now, data.timeZone), columnWidth)))
      rows += 2 + line
    }

    return rows + 1
  }
  if (id === 'context-tracker') {
    if (data.usage === null) {
      return 1
    }

    return 2 + legendRows(data.usage, inner) + 1
  }

  return 0
}

// Rows the pane's body takes for the list or a mod's page at `width` cells.
export function paneRows(
  mods: readonly ModPanelMod[],
  page: ModPanelMod | null,
  width: number,
  data: { limits: readonly ModPanelLimit[]; usage: ModPanelUsage | null; now: number; timeZone: string },
): number {
  if (page === null) {
    // Title, gap, a row per mod, gap, keys.
    return 3 + mods.length + wrappedRows(listKeys(mods.length, width), width)
  }
  const details = detailRows(page.id, width, data)

  // Title and switch, gap, what it does, a gap before the details, keys.
  return 2 + wrappedRows(page.about, width) + (details > 0 ? 1 + details : 0) + wrappedRows(PAGE_KEYS, width)
}

// `12:50pm` on the day it is read, `Oct 10, 8pm` past it.
export function formatReset(resetsAt: string, now: number, timeZone: string): string {
  const at = new Date(resetsAt)
  const time = at
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
    .replace(':00', '')
    .replace(' ', '')
    .toLowerCase()
  const day = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })

  return day(at) === day(new Date(now)) ? time : `${day(at)}, ${time}`
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

// The panel element holding the focus ring, to tell an ↑ from a ↓ when the ring lands on a switch.
let focused: string | null = null
// The pane body's width as last drawn, for sizing it before the next draw.
let paneColumns = DOCK_COLUMNS - 4

// Sets the mod up for a session: at its start, and again after a /clear.
async function setUp($: $): Promise<void> {
  await markInstalled($, (await $.command.list()).map(command => command.name))
  await $.command.register({
    name: 'mods',
    description: 'Open or close the panel that turns each mod on or off',
  })
}

export function registerModPanel(on: On): void {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await setUp($)

    return result
  })

  // A /clear fires no `session.start`, and the engine skips a user plugin's `classic.SessionStart`.
  // The new session empties this mod's values once `session.end` is done, so set up after that.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') {
      $.clock.after(CLEAR_SETTLE_MS, async () => {
        await setUp($)
      })
    }

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


  // In the list, the ring stops on names only: a move onto a switch lands on a name instead,
  // so ↑ and ↓ go from one mod's name to the next. A switch still turns on a click.
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const target = e.element
    const isList = (await read($, pageAtom)) === null
    // ↑ on the first name keeps the ring there rather than on the close mark; every other move passes.
    if (isList && e.origin.kind === 'person' && target === undefined && focused !== null && focused === `page-${(await installedMods($))[0]?.id}`) {
      return { deny: 'the first name keeps the ring' }
    }
    if (e.origin.kind !== 'person' || target === undefined || !/^(toggle|hot)-/.test(target) || !isList) {
      const result = await next(e)
      focused = target ?? null
      return result
    }
    const mods = await installedMods($)
    const rowOf = (key: string | null) => mods.findIndex(mod => key !== null && key.endsWith(`-${mod.id}`))
    const row = rowOf(target)
    const from = rowOf(focused)
    // From a name, `next` reaches its own switch: go on to the next name. From below, `previous` reaches the row's switch: stop on its name.
    const isForward = from !== -1 && from === row && focused?.startsWith('page-') === true
    const landing = isForward ? mods[Math.min(mods.length - 1, row + 1)] : mods[row]
    if (landing === undefined) {
      return next(e)
    }
    const element = `page-${landing.id}`
    const result = await next({ ...e, element })
    focused = element

    return result
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
        <Button key="open-mods" label={isOpen ? 'Mods ▴' : 'Mods ▾'} action={SHORTCUT_ACTION} onPress={() => togglePanel($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const mods = await installedMods($)
    const nameWidth = Math.max(0, ...mods.map(mod => mod.name.length)) + 2
    const hintWidth = Math.max(0, ...mods.map(mod => mod.hint.length)) + 2
    // A docked pane can be narrow: past the room for a hint, rows leave it out.
    const hasHints = e.props.bodyColumns >= 2 + nameWidth + hintWidth + SWITCH_WIDTH
    // Narrower still, the switch drops its brackets so it is not cut off.
    const isCompact = e.props.bodyColumns < 2 + nameWidth + SWITCH_WIDTH

    const states: Record<Mod['id'], boolean> = {
      'minimal-view': (await $.state.get(minimalViewEnabled)).value ?? true,
      'context-tracker': (await $.state.get(contextTrackerShown)).value ?? true,
      'usage-tracker': (await $.state.get(usageTrackerShown)).value ?? true,
    }
    const page = await read($, pageAtom)
    const isShowing = (id: Mod['id']) => page === id
    const usage = isShowing('context-tracker') ? (await $.state.get(contextTrackerUsage)).value ?? null : null
    const limits: ModPanelLimit[] = isShowing('usage-tracker') ? (await $.state.get(usageTrackerLimits)).value ?? [] : []
    const now = await $.clock.now()
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    paneColumns = e.props.bodyColumns
    // The pane's body, less the details' indent.
    const width = Math.max(10, e.props.bodyColumns - 2)

    const limitDetails = () => {
      if (limits.length === 0) {
        return <Text dimColor>  {NO_LIMITS}</Text>
      }
      const { columnWidth } = limitLayout(limits.length, width)

      return (
        <Box key="details-usage-tracker" flexDirection="column" paddingLeft={2} marginBottom={1}>
          <Box flexDirection="row" flexWrap="wrap" columnGap={LIMIT_GAP}>
            {limits.map(limit => {
              const bar = limitBar(limit.percentUsed, columnWidth)

              return (
                <Box key={`limit-${limit.kind}`} flexDirection="column" width={columnWidth}>
                  <Text bold>{limitName(limit.kind)}</Text>
                  <Text>
                    <Text color="claude">{'█'.repeat(bar.full)}</Text>
                    {bar.partial === '' ? null : <Text color="claude" backgroundColor={FREE_COLOR}>{bar.partial}</Text>}
                    <Text color={FREE_COLOR}>{'█'.repeat(bar.rest)}</Text>
                  </Text>
                  <Text>
                    <Text bold>{Math.round(limit.percentUsed)}% used</Text>
                    <Text dimColor>{limitLine(limit, now, timeZone).slice(`${Math.round(limit.percentUsed)}% used`.length)}</Text>
                  </Text>
                </Box>
              )
            })}
          </Box>
        </Box>
      )
    }

    const details = (mod: Mod) => {
      if (mod.id === 'usage-tracker') {
        return limitDetails()
      }
      if (mod.id !== 'context-tracker') {
        return null
      }
      if (usage === null) {
        return <Text dimColor>  Measuring the context window…</Text>
      }
      const compacts = usage.compactAt === null ? '' : ` · compacts at ${formatTokens(usage.compactAt)}`

      return (
        <Box key="details-context-tracker" flexDirection="column" paddingLeft={2} marginBottom={1}>
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
            {legendItems(usage).map(row => (
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

    const toggle = (mod: Mod, isAutoFocus: boolean) => {
      const isOn = states[mod.id]

      if (isCompact) {
        return (
          <Button
            key={`toggle-${mod.id}`}
            plain
            dimColor={isOn ? undefined : true}
            label={isOn ? 'On' : 'Off'}
            autoFocus={isAutoFocus ? true : undefined}
            onPress={() => setMod($, mod, !isOn)}
          />
        )
      }

      return (
        <Button
          key={`toggle-${mod.id}`}
          label={isOn ? '● On ' : '○ Off'}
          variant={isOn ? 'primary' : 'secondary'}
          autoFocus={isAutoFocus ? true : undefined}
          onPress={() => setMod($, mod, !isOn)}
        />
      )
    }

    // Number keys open a page and `q` goes back. Their Buttons are hidden, so no `1:` is drawn.
    const hiddenKeys = (page === null
      ? mods.slice(0, 9).map((mod, index) => (
          <Button key={`hot-${mod.id}`} hotkey={String(index + 1)} label={mod.name} onPress={() => showPage($, mod.id)} />
        ))
      : [<Button key="hot-back" hotkey={BACK_KEY} label="Back" onPress={() => showPage($, null)} />])
    const keys = <Box key="keys" display="none">{hiddenKeys}</Box>

    const shown = mods.find(mod => mod.id === page)
    if (shown !== undefined) {
      const body = details(shown)

      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Button key="back" plain dimColor label="← Mods" onPress={() => showPage($, null)} />
            <Text dimColor> / </Text>
            <Text bold>{shown.name}</Text>
            <Text>  </Text>
            {toggle(shown, true)}
          </Box>
          <Text> </Text>
          <Text>{shown.about}</Text>
          {body === null ? null : <Text> </Text>}
          {body}
          <Text dimColor>{PAGE_KEYS}</Text>
          {keys}
        </Box>
      )
    }

    const rows = mods.map((mod, index) => {
      const isOn = states[mod.id]

      return (
        <Box key={`row-${mod.id}`} flexDirection="row">
          <Box width={2} flexShrink={0}>
            {isOn ? <Text color="success">●</Text> : <Text dimColor>○</Text>}
          </Box>
          <Button
            key={`page-${mod.id}`}
            plain
            label={mod.name.padEnd(isCompact ? Math.min(nameWidth, e.props.bodyColumns - 6) : nameWidth)}
            autoFocus={index === 0 ? true : undefined}
            onPress={() => showPage($, mod.id)}
          />
          {hasHints && <Text dimColor>{mod.hint.padEnd(hintWidth)}</Text>}
          {toggle(mod, false)}
        </Box>
      )
    })

    return (
      <Box flexDirection="column">
        <Text dimColor>Mods</Text>
        <Text> </Text>
        {rows}
        <Text> </Text>
        <Text dimColor>{listKeys(mods.length, e.props.bodyColumns)}</Text>
        {keys}
      </Box>
    )
  })
}
