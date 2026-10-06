import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, SessionContextBreakdown } from 'claude-code'

import type { ContextBarItem, ContextBarRow, ContextBarUsage } from '../types'

type $ = EngineInterface

const shownAtom = atom({ plugin: 'context-bar', key: 'isShown' } as const, true)
const collapsedAtom = atom({ plugin: 'context-bar', key: 'isCollapsed' } as const, false)
const openRowAtom = atom({ plugin: 'context-bar', key: 'openRow' } as const, null)
const itemLimitAtom = atom({ plugin: 'context-bar', key: 'itemLimit' } as const, 10)
const turnBaseAtom = atom({ plugin: 'context-bar', key: 'turnBase' } as const, null)
const usageAtom = atom({ plugin: 'context-bar', key: 'usage' } as const, null)

const SHOWN_KEY = 'isShown'
const COLLAPSED_KEY = 'isCollapsed'
const REFRESH_MS = 3000
const MIN_BAR = 10
const ITEM_PAGE = 10
const FREE_COLOR = '#3a3f4b'
const MARKER_COLOR = '#e0a84f'
const BADGE_TEXT = '#1b1d22'

// Names and colors match each /context row; the engine's own theme colors repeat across rows.
const CATEGORIES: { match: RegExp; name: string; color: string }[] = [
  { match: /^system prompt/i, name: 'system prompt', color: '#6f9bd8' },
  { match: /^mcp/i, name: 'mcp', color: '#9d86f0' },
  { match: /tools/i, name: 'tools', color: '#5bb8c4' },
  { match: /agents/i, name: 'agents', color: '#8fcb8a' },
  { match: /^memory/i, name: 'memory files', color: '#e8c35d' },
  { match: /^skills/i, name: 'skills', color: '#f2a1c3' },
  { match: /^messages/i, name: 'messages', color: '#e07a52' },
  { match: /^free/i, name: 'free', color: FREE_COLOR },
]
const EXTRA_COLORS = ['#d9b38c', '#7fd6c2', '#e5736b', '#b8d65c']

export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return `${tokens}`
  }
  if (tokens < 1_000_000) {
    return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  }

  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

function shortPath(path: string): string {
  return path.split('/').slice(-2).join('/')
}

// Sums items by name and sorts the largest first.
function itemList(entries: ContextBarItem[]): ContextBarItem[] {
  const byName = new Map<string, number>()
  for (const entry of entries) {
    byName.set(entry.name, (byName.get(entry.name) ?? 0) + entry.tokens)
  }

  return [...byName].map(([name, tokens]) => ({ name, tokens })).sort((a, b) => b.tokens - a.tokens)
}

// The breakdown lists what makes up these rows; built-in tools have a total alone.
function itemsFor(name: string, breakdown: SessionContextBreakdown): ContextBarItem[] {
  switch (name) {
    case 'mcp':
      return itemList(breakdown.mcpTools.filter(tool => tool.isLoaded).map(tool => ({ name: tool.serverName, tokens: tool.tokens })))
    case 'skills':
      return itemList((breakdown.skills?.skillFrontmatter ?? []).map(skill => ({ name: skill.name, tokens: skill.tokens })))
    case 'agents':
      return itemList(breakdown.agents.map(agent => ({ name: agent.agentType, tokens: agent.tokens })))
    case 'memory files':
      return itemList(breakdown.memoryFiles.map(file => ({ name: shortPath(file.path), tokens: file.tokens })))
    default:
      return []
  }
}

export function toUsage(breakdown: SessionContextBreakdown): ContextBarUsage {
  // Rows that share a name (MCP tools and MCP server instructions) are summed into one.
  const rows: ContextBarRow[] = []
  for (const category of breakdown.categories) {
    if (category.kind !== 'used' && category.kind !== 'free') {
      continue
    }
    const known = CATEGORIES.find(entry => entry.match.test(category.name))
    const name = known?.name ?? category.name.toLowerCase()
    const same = rows.find(row => row.name === name)
    if (same !== undefined) {
      same.tokens += category.tokens
      continue
    }
    rows.push({
      name,
      tokens: category.tokens,
      color: category.kind === 'free' ? FREE_COLOR : (known?.color ?? EXTRA_COLORS[rows.length % EXTRA_COLORS.length]!),
      kind: category.kind,
      items: itemsFor(name, breakdown),
    })
  }

  // Largest first; free space always last.
  rows.sort((a, b) => (a.kind === 'free' ? 1 : 0) - (b.kind === 'free' ? 1 : 0) || b.tokens - a.tokens)

  return {
    rows,
    totalTokens: breakdown.totalTokens,
    maxTokens: breakdown.rawMaxTokens,
    percent: breakdown.percentage,
    compactAt: breakdown.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null,
  }
}

// Splits `width` cells among the used rows by their tokens; a row with any tokens gets at least one cell.
export function barCells(usage: ContextBarUsage, width: number): { color: string; cells: number }[] {
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

function badgeColor(percent: number): string {
  if (percent >= 80) {
    return '#e5736b'
  }

  return percent >= 50 ? '#e8c35d' : '#8fcb8a'
}

// The bar as an SVG for surfaces that draw one: a thin rounded strip, each row a slice, a tick at the compaction point.
function barSvg(usage: ContextBarUsage): string {
  const max = Math.max(1, usage.maxTokens)
  let x = 0
  const slices = usage.rows
    .filter(row => row.kind === 'used' && row.tokens > 0)
    .map(row => {
      const width = Math.max(0.3, (row.tokens / max) * 1000)
      const slice = `<rect x="${x.toFixed(2)}" y="0" width="${width.toFixed(2)}" height="12" fill="${row.color}"/>`
      x += width

      return slice
    })
  const tick =
    usage.compactAt === null ? '' : `<rect x="${Math.min(997, (usage.compactAt / max) * 1000).toFixed(2)}" y="0" width="3" height="12" fill="${MARKER_COLOR}"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 12" width="100%" height="12" preserveAspectRatio="none"><clipPath id="r"><rect width="1000" height="12" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="1000" height="12" fill="${FREE_COLOR}"/>${slices.join('')}${tick}</g></svg>`
}

let lastRefresh = 0

// The summary breakdown is estimated locally, so reading it while the card is hidden costs nothing either.
async function refresh($: $, isForced = false): Promise<void> {
  const now = await $.clock.now()
  if (!isForced && now - lastRefresh < REFRESH_MS) {
    return
  }
  lastRefresh = now
  const { context } = await $.session.usage({ breakdown: 'summary' })
  if (context.breakdown !== undefined) {
    const usage = toUsage(context.breakdown)
    await update($, usageAtom, () => usage)
  }
}

// Called after the engine has answered, so a failed reading leaves the bar as it was.
function refreshLater($: $, isForced = false): void {
  refresh($, isForced).catch(() => {})
}

async function setShown($: $, isShown: boolean): Promise<void> {
  await update($, shownAtom, () => isShown)
  await $.store.set(SHOWN_KEY, isShown)
  await refresh($, true).catch(() => {})
}

async function setCollapsed($: $, isCollapsed: boolean): Promise<void> {
  await update($, collapsedAtom, () => isCollapsed)
  await $.store.set(COLLAPSED_KEY, isCollapsed)
}

export function registerContextBar(on: On): void {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const isShown = await $.store.get(SHOWN_KEY)
    const isCollapsed = await $.store.get(COLLAPSED_KEY)
    await update($, shownAtom, () => isShown !== false)
    await update($, collapsedAtom, () => isCollapsed === true)
    await $.command.register({
      name: 'context-bar',
      description: 'Show or hide the context bar above the prompt',
      argumentHint: 'on|off',
    })
    await refresh($, true).catch(() => {})

    return result
  })

  on('command.run', { command: 'context-bar' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') {
      return { text: 'Use /context-bar on, /context-bar off, or /context-bar to switch.' }
    }
    const isShown = arg === '' ? !(await read($, shownAtom)) : arg === 'on'
    await setShown($, isShown)

    return { text: isShown ? 'Context bar shown.' : 'Context bar hidden.' }
  })

  on('turn.start', async ($, e, next) => {
    const usage = await read($, usageAtom)
    await update($, turnBaseAtom, () => usage?.totalTokens ?? null)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    refreshLater($)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($, true).catch(() => {})

    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    await update($, turnBaseAtom, () => null)
    refreshLater($, true)

    return result
  })

  // Hidden, the card's figures stay in the prompt footer's mode labels; `$.ui.status` would add a warning sign and the plugin's name.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const usage = await read($, usageAtom)
    if (usage === null || (await read($, shownAtom))) {
      return next(e)
    }
    const label = `◆ context ${formatTokens(usage.totalTokens)} · ${Math.round(usage.percent)}%`

    return next({ ...e, props: { ...e.props, modes: [label, ...e.props.modes] } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const usage = await read($, usageAtom)
    if (e.props.hasSurvey || usage === null || !(await read($, shownAtom))) {
      return next(e)
    }
    const isCollapsed = await read($, collapsedAtom)
    const openRow = await read($, openRowAtom)
    const itemLimit = await read($, itemLimitAtom)
    const turnBase = await read($, turnBaseAtom)
    const width = Math.max(MIN_BAR + 4, e.props.bodyColumns)
    const percent = Math.round(usage.percent)
    const max = Math.max(1, usage.maxTokens)
    const turnDelta = turnBase === null ? 0 : usage.totalTokens - turnBase
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements

    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text>
            <Text color="claude">◆ </Text>
            <Text bold>context </Text>
          </Text>
          <Button
            key="collapse"
            plain
            dimColor
            label={isCollapsed ? '▸' : '▾'}
            onPress={() => setCollapsed($, !isCollapsed)}
          />
        </Box>
        <Text>
          <Text bold>{formatTokens(usage.totalTokens)}</Text>
          {turnDelta > 0 ? <Text color="claude"> +{formatTokens(turnDelta)}</Text> : null}
          <Text dimColor>
            {' '}of {formatTokens(usage.maxTokens)}
            {usage.compactAt === null ? '' : ` · compacts at ${formatTokens(usage.compactAt)}`}{' '}
          </Text>
          <Text bold color={BADGE_TEXT} backgroundColor={badgeColor(percent)}> {percent}% </Text>
        </Text>
      </Box>
    )

    let bar
    // Branch on the surface: the terminal's element table is not told apart by its keys.
    if (e.surface !== 'terminal' && 'Svg' in elements) {
      const { Svg } = elements
      bar = <Svg source={barSvg(usage)} alt={`Context ${percent}% full`} />
    } else {
      const barWidth = width - 4
      const compactCell = usage.compactAt === null ? null : Math.min(barWidth - 1, Math.round((usage.compactAt / max) * barWidth))
      let start = 0
      bar = (
        <Text wrap="truncate-end">
          {barCells(usage, barWidth).map((segment, index) => {
            const at = start
            start += segment.cells
            if (segment.color !== FREE_COLOR || compactCell === null || compactCell < at) {
              return <Text key={`seg-${index}`} color={segment.color}>{'█'.repeat(segment.cells)}</Text>
            }
            const before = compactCell - at

            return (
              <Text key={`seg-${index}`}>
                <Text color={FREE_COLOR}>{'█'.repeat(before)}</Text>
                <Text color={MARKER_COLOR} backgroundColor={FREE_COLOR}>▕</Text>
                <Text color={FREE_COLOR}>{'█'.repeat(Math.max(0, segment.cells - before - 1))}</Text>
              </Text>
            )
          })}
        </Text>
      )
    }

    const opened = usage.rows.find(row => row.name === openRow && row.items.length > 0)
    const details =
      opened === undefined ? null : (
        <Box flexDirection="column" marginTop={1}>
          {opened.items.slice(0, itemLimit).map(item => (
            <Box key={`item-${item.name}`} flexDirection="row" justifyContent="space-between" width={Math.min(width - 4, 48)}>
              <Text wrap="truncate-end">
                <Text color={opened.color}>│ </Text>
                <Text>{item.name}</Text>
              </Text>
              <Text bold>{formatTokens(item.tokens)}</Text>
            </Box>
          ))}
          {opened.items.length > ITEM_PAGE ? (
            <Box flexDirection="row">
              <Text color={opened.color}>│ </Text>
              {opened.items.length > itemLimit ? (
                <Button
                  key="more"
                  plain
                  dimColor
                  label={`+${Math.min(ITEM_PAGE, opened.items.length - itemLimit)} more (${opened.items.length - itemLimit} left)`}
                  onPress={() => update($, itemLimitAtom, limit => limit + ITEM_PAGE)}
                />
              ) : null}
              {opened.items.length > itemLimit ? <Text>  </Text> : null}
              {itemLimit > ITEM_PAGE ? (
                <Button key="less" plain dimColor label="show less" onPress={() => update($, itemLimitAtom, () => ITEM_PAGE)} />
              ) : null}
            </Box>
          ) : null}
        </Box>
      )

    const card = (
      <Box key="context-bar" flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={width}>
        {header}
        {isCollapsed ? null : bar}
        {isCollapsed ? null : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {usage.rows.map(row => (
              <Box key={`row-${row.name}`} flexDirection="row">
                <Text>
                  <Text color={row.color}>■ </Text>
                  <Text>{row.name} </Text>
                  <Text bold>{formatTokens(row.tokens)}</Text>
                  {row.kind === 'free' ? null : <Text dimColor> {Math.round((row.tokens / max) * 100)}%</Text>}
                </Text>
                {row.items.length === 0 ? null : (
                  <Button
                    key={`open-${row.name}`}
                    plain
                    dimColor
                    label={row.name === openRow ? ' ▾' : ' ▸'}
                    onPress={async () => {
                      await update($, itemLimitAtom, () => ITEM_PAGE)
                      await update($, openRowAtom, current => (current === row.name ? null : row.name))
                    }}
                  />
                )}
              </Box>
            ))}
          </Box>
        )}
        {isCollapsed ? null : details}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {card}
        {await next(e)}
      </Box>
    )
  })
}
