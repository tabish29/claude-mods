import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CacheSnapshot } from '../types'

const last = atom({ plugin: 'cache-watch', key: 'last' } as const, null)
const now = atom({ plugin: 'cache-watch', key: 'now' } as const, 0)
const isHidden = atom({ plugin: 'cache-watch', key: 'isHidden' } as const, false)

const TTL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const
// Cache writes bill at 1.25x the input price for the 5m cache, 2x for the 1h one;
// a cache read bills at 0.1x.
const WRITE_FACTOR = { '5m': 1.25, '1h': 2 } as const
const READ_FACTOR = 0.1

const guessPrice = (model: string) => {
  if (/opus/i.test(model)) return 5
  if (/haiku/i.test(model)) return 1
  return 3
}

const usd = (value: number) =>
  value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`

const clockText = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = String(total % 60).padStart(2, '0')

  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
    : `${minutes}:${seconds}`
}

export const register: Register = (on, options) => {
  const ttl = options.cacheTtl === '1h' ? '1h' : '5m'
  const customPrice = Number(options.inputPricePerMTok) || 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cache-watch',
      description: 'Show or hide the prompt cache band above the prompt',
    })
    // Redraws the band every second so the countdown moves.
    $.clock.every(1000, async () => {
      if ((await read($, last)) !== null) {
        const time = await $.clock.now()
        await update($, now, () => time)
      }
    })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await update($, last, () => null)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const usage = response.usage

    if (e.agentId === undefined && usage !== null) {
      const snapshot: CacheSnapshot = {
        at: await $.clock.now(),
        model: usage.model,
        contextTokens:
          usage.input_tokens +
          usage.cache_read_input_tokens +
          usage.cache_creation_input_tokens +
          usage.output_tokens,
        readTokens: usage.cache_read_input_tokens,
      }
      await update($, last, () => snapshot)
      await update($, now, () => snapshot.at)
    }

    return response
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snapshot = await read($, last)

    if (e.props.hasSurvey || snapshot === null || (await read($, isHidden))) {
      return next(e)
    }

    const current = Math.max(await read($, now), snapshot.at)
    const remaining = snapshot.at + TTL_MS[ttl] - current
    const isWarm = remaining > 0
    const price = customPrice > 0 ? customPrice : guessPrice(snapshot.model)
    const million = snapshot.contextTokens / 1_000_000
    const cold = million * price * WRITE_FACTOR[ttl]
    const warm = million * price * READ_FACTOR
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text color={isWarm ? 'green' : 'yellow'}>
          Cache {isWarm ? `warm, expires in ${clockText(remaining)}` : 'cold'}
        </Text>
        <Text dimColor>
          {' '}
          · {Math.round(snapshot.contextTokens / 1000)}k tokens · cold prompt ~
          {usd(cold)} · warm ~{usd(warm)} (est.){' '}
        </Text>
        <Button
          key="hide"
          label="Hide"
          onPress={() => update($, isHidden, () => true)}
        />
      </Box>
    )
  })

  on('command.run', { command: 'cache-watch' }, async $ => {
    const hidden = await read($, isHidden)
    await update($, isHidden, () => !hidden)

    return { text: hidden ? 'Cache band shown.' : 'Cache band hidden.' }
  })
}
