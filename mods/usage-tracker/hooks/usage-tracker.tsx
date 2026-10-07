import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, SessionRateLimit } from 'claude-code'

import type { UsageTrackerLimit } from '../types'

type $ = EngineInterface

const shownAtom = atom({ plugin: 'usage-tracker', key: 'isShown' } as const, true)
const limitsAtom = atom({ plugin: 'usage-tracker', key: 'limits' } as const, [])
const turnBaseAtom = atom({ plugin: 'usage-tracker', key: 'turnBase' } as const, null)
const lastDeltaAtom = atom({ plugin: 'usage-tracker', key: 'lastDelta' } as const, null)

const SHOWN_KEY = 'isShown'
const SESSION_KIND = 'five_hour'
// How long after a request ends its last measurement may still arrive.
const SETTLE_MS = 3000

// Counts requests, so a late settle for one request never lands on the next.
let requestCounter = 0
// Space between this mod's figures and the next entry in the prompt footer.
const FOOTER_GAP = '  '

export function toLimits(rateLimits: readonly SessionRateLimit[]): UsageTrackerLimit[] {
  return rateLimits.map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt ?? null }))
}

export function sessionPercent(limits: readonly UsageTrackerLimit[]): number | null {
  return limits.find(limit => limit.kind === SESSION_KIND)?.percentUsed ?? null
}

// Whole numbers stay whole, the rest keep one decimal: 57%, 1.5%.
export function formatPercent(percent: number): string {
  return `${Math.round(percent * 10) / 10}%`
}

async function setLimits($: $, rateLimits: readonly SessionRateLimit[]): Promise<void> {
  const limits = toLimits(rateLimits)
  await update($, limitsAtom, () => limits)
}

// What the request took of the session window: a window that reset mid-request starts again from zero.
export function requestDelta(base: number, now: number): number {
  return now >= base ? now - base : now
}

// Settles the finished request's share once its last measurement has come in. Measurements while
// idle (another session sharing the window) only move the figure, never the last request's share.
async function settleRequest($: $, request: number): Promise<void> {
  if (request !== requestCounter) {
    return
  }
  const base = await read($, turnBaseAtom)
  const now = sessionPercent(await read($, limitsAtom))
  await update($, lastDeltaAtom, last => (base === null || now === null ? last : requestDelta(base, now)))
  await update($, turnBaseAtom, () => null)
}

async function setShown($: $, isShown: boolean): Promise<void> {
  await update($, shownAtom, () => isShown)
  await $.store.set(SHOWN_KEY, isShown)
}

export function registerUsageTracker(on: On): void {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const isShown = await $.store.get(SHOWN_KEY)
    await update($, shownAtom, () => isShown !== false)
    await $.command.register({
      name: 'usage-tracker',
      description: 'Show or hide your plan usage under the prompt',
      argumentHint: 'on|off',
    })
    const { rateLimits } = await $.session.usage()
    await setLimits($, rateLimits)

    return result
  })

  // The mod-panel plugin turns this mod on or off by writing its `switch` request.
  on('state.set', { plugin: 'mod-panel', key: 'switch' } as never, async ($, e, next) => {
    const result = await next(e)
    const request = (e as { value?: { mod?: string; isOn?: boolean } | null }).value
    if (request?.mod === 'usage-tracker' && typeof request.isOn === 'boolean') {
      await setShown($, request.isOn)
    }

    return result
  })

  on('command.run', { command: 'usage-tracker' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') {
      return { text: 'Use /usage-tracker on, /usage-tracker off, or /usage-tracker to switch.' }
    }
    const isShown = arg === '' ? !(await read($, shownAtom)) : arg === 'on'
    await setShown($, isShown)

    return { text: isShown ? 'Usage tracker shown.' : 'Usage tracker hidden.' }
  })

  // Each request is measured from where the session window stood when it began.
  on('turn.start', async ($, e, next) => {
    requestCounter += 1
    let now = sessionPercent(await read($, limitsAtom))
    if (now === null) {
      // Not measured yet this session: ask, as the status line may already know.
      const { rateLimits } = await $.session.usage()
      await setLimits($, rateLimits)
      now = sessionPercent(toLimits(rateLimits))
    }
    await update($, turnBaseAtom, () => now)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const request = requestCounter
      $.clock.after(SETTLE_MS, () => {
        void settleRequest($, request).catch(() => {})
      })
    }

    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('rateLimits')) {
      await setLimits($, e.rateLimits)
    }

    return result
  })

  // The session window's use and what the last request took sit in the prompt footer, by the mode labels.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const now = sessionPercent(await read($, limitsAtom))
    if (now === null || !(await read($, shownAtom))) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const delta = await read($, lastDeltaAtom)
    const modes = await next(e)

    return (
      <Box flexDirection="row">
        <Text>
          <Text color="claude">◇ </Text>
          <Text dimColor>usage </Text>
          <Text bold>{formatPercent(now)}</Text>
          {delta === null ? null : <Text dimColor> · last +{formatPercent(delta)}</Text>}
          <Text>{FOOTER_GAP}</Text>
        </Text>
        {modes}
      </Box>
    )
  })
}
