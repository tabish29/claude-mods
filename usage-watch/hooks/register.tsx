import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

import type { UsageWindow } from '../types'

const windows = atom({ plugin: 'usage-watch', key: 'windows' } as const, [])
const now = atom({ plugin: 'usage-watch', key: 'now' } as const, 0)
const isHidden = atom({ plugin: 'usage-watch', key: 'isHidden' } as const, false)

const LABEL: Record<string, string> = { five_hour: 'Session (5h)', seven_day: 'Week' }

const toWindows = (limits: SessionRateLimit[]): UsageWindow[] =>
  limits
    .filter(l => l.kind in LABEL)
    .map(l => ({
      kind: l.kind,
      percentUsed: l.percentUsed,
      resetsAt: l.resetsAt ? Date.parse(l.resetsAt) : null,
    }))

const color = (percent: number) =>
  percent >= 90 ? 'red' : percent >= 70 ? 'yellow' : 'green'

const bar = (percent: number) => {
  const filled = Math.round(Math.min(percent, 100) / 10)
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

const resetText = (ms: number) => {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60

  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${rest}m` : `${rest}m`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-watch',
      description: 'Show or hide the session and weekly usage band above the prompt',
    })
    // Redraws every 30s so the reset countdowns move.
    $.clock.every(30_000, async () => {
      if ((await read($, windows)).length > 0) {
        const time = await $.clock.now()
        await update($, now, () => time)
      }
    })
    // Pick up the readings a resumed session already has.
    const usage = await $.session.usage()
    await update($, windows, () => toWindows(usage.rateLimits))
    await update($, now, () => Date.now())

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, windows, () => toWindows(e.rateLimits))
      await update($, now, () => Date.now())
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, windows)

    if (e.props.hasSurvey || list.length === 0 || (await read($, isHidden))) {
      return next(e)
    }

    const current = Math.max(await read($, now), Date.now())
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        {list.map(w => (
          <Text key={w.kind}>
            <Text dimColor>{LABEL[w.kind]} </Text>
            <Text color={color(w.percentUsed)}>
              {bar(w.percentUsed)} {Math.round(w.percentUsed)}%
            </Text>
            <Text dimColor>
              {w.resetsAt !== null && ` resets in ${resetText(w.resetsAt - current)}`}
              {'  '}
            </Text>
          </Text>
        ))}
        <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })

  on('command.run', { command: 'usage-watch' }, async $ => {
    const hidden = await read($, isHidden)
    await update($, isHidden, () => !hidden)

    return { text: hidden ? 'Usage band shown.' : 'Usage band hidden.' }
  })
}
