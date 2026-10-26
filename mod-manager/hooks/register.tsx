import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModRow } from '../types'

const PANE = 'mod-manager'
const TITLE = 'Mods'
/** This marketplace: its plugins are listed first, as "Claude Mods". */
const MODS_MARKETPLACE = 'claude-mods'
const SELF = 'mod-manager'

const rows = atom({ plugin: 'mod-manager', key: 'rows' } as const, [])
const busy = atom({ plugin: 'mod-manager', key: 'busy' } as const, null)
const error = atom({ plugin: 'mod-manager', key: 'error' } as const, null)

type Installed = { id: string; enabled: boolean; scope?: string }
type Seen = { name: string; provenance: string }

/** Modules loaded in this session: `engine.create` provides them on every load (hooking it reloads them all). */
let loaded: readonly string[] = []
/** Plugins registered after this one, with their provenance (`name@marketplace`, `name@inline`). */
const seen: Seen[] = []
/** `enabledPlugins` as of the last load: for plugins without modules (skills only) this is what is active. */
let enabledAtLoad: Record<string, unknown> = {}

const isBuiltin = (name: string, id = '') => name.startsWith('cc-plugin-') || id.endsWith('@builtin')

const nameOf = (id: string) => id.split('@')[0] ?? id

async function describe($: EngineInterface, root: string) {
  try {
    const json = await $.fs.read(`${root}/.claude-plugin/plugin.json`)
    return (JSON.parse(json) as { description?: string }).description ?? ''
  } catch {
    return ''
  }
}

async function refresh($: EngineInterface) {
  const listed = await $.process.run(['claude', 'plugin', 'list', '--json'], { timeoutMs: 30_000 })
  if (listed.exitCode !== 0) throw new Error(listed.stderr.trim() || 'claude plugin list did not respond')
  const installed = (JSON.parse(listed.stdout) as (Installed & { installPath?: string })[]).filter(
    p => p.scope !== 'session' && !isBuiltin(nameOf(p.id), p.id),
  )

  const next: ModRow[] = []
  for (const p of installed) {
    const name = nameOf(p.id)
    next.push({
      id: p.id,
      name,
      description: p.installPath ? await describe($, p.installPath) : '',
      isActive: loaded.includes(name) || enabledAtLoad[p.id] === true,
      isEnabled: p.enabled,
      group: p.id.endsWith(`@${MODS_MARKETPLACE}`) ? 'mods' : 'plugins',
    })
  }

  // Loaded from a folder (--plugin-dir, CLAUDE_CODE_PLUGIN_DIRS, this session's mods): not installed.
  const known = new Set(next.map(r => r.name))
  for (const name of loaded) {
    if (known.has(name) || isBuiltin(name) || name === SELF) continue
    known.add(name)
    next.push({
      id: seen.find(s => s.name === name)?.provenance ?? `${name}@inline`,
      name,
      description: '',
      isActive: true,
      isEnabled: null,
      group: 'session',
    })
  }

  const order = { mods: 0, session: 1, plugins: 2 }
  next.sort((a, b) => order[a.group] - order[b.group] || a.name.localeCompare(b.name))
  await update($, rows, () => next)
}

async function safeRefresh($: EngineInterface) {
  try {
    await refresh($)
    await update($, error, () => null)
  } catch (err) {
    await update($, error, () => `Could not read the list: ${String((err as Error).message ?? err)}`)
  }
}

async function toggle($: EngineInterface, row: ModRow) {
  if ((await read($, busy)) !== null || row.isEnabled === null) return
  await update($, busy, () => row.id)
  try {
    const verb = row.isEnabled ? 'disable' : 'enable'
    const done = await $.process.run(['claude', 'plugin', verb, row.id, '--scope', 'user'], { timeoutMs: 60_000 })
    if (done.exitCode !== 0) {
      await update($, error, () => `${row.name}: ${(done.stderr || done.stdout).trim()}`)
    } else {
      await update($, error, () => null)
      $.ui.toast(`${row.name} ${row.isEnabled ? 'turned off' : 'turned on'}: press Enter to reload the mods`)
      await $.prompt.fill({ text: '/reload-plugins' })
    }
    await refresh($)
  } catch (err) {
    await update($, error, () => `${row.name}: ${String((err as Error).message ?? err)}`)
  } finally {
    await update($, busy, () => null)
  }
}

export const register: Register = on => {
  on('engine.create', async (_$, e, next) => {
    loaded = e.plugins
    return next(e)
  })

  on('plugin.register', async (_$, e, next) => {
    seen.push({ name: e.name, provenance: e.provenance })
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    enabledAtLoad = ((await $.settings.read({ key: 'enabledPlugins' })) as Record<string, unknown> | undefined) ?? {}
    await $.command.register({ name: 'mods', description: 'Show the mods and plugins, which ones are active, and turn them on or off' })
    // A pane left open redraws with the data from the new load.
    if ((await $.ui.panes()).some(p => p.id === PANE)) void safeRefresh($)
    return started
  })

  on('command.run', { command: 'mods' }, async $ => {
    await safeRefresh($)
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
    const list = await read($, rows)
    const active = list.filter(r => r.isActive).map(r => r.name)
    return {
      text: opened.isPlaced
        ? `Mod panel opened. Active now: ${active.join(', ') || 'none'}.`
        : `Active now: ${active.join(', ') || 'none'}. The panel cannot open here (${opened.reason}).`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, rows)
    const working = await read($, busy)
    const problem = await read($, error)
    const pending = list.some(r => r.isEnabled !== null && r.isEnabled !== r.isActive)

    const status = (r: ModRow) => {
      if (r.isEnabled === null) return 'active in this session only'
      if (r.isActive && r.isEnabled) return 'active'
      if (!r.isActive && !r.isEnabled) return 'off'
      return r.isEnabled ? 'on, starts at reload' : 'off, stays active until reload'
    }

    const section = (group: ModRow['group'], heading: string, note?: string) => {
      const items = list.filter(r => r.group === group)
      if (items.length === 0) return null
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>{heading}</Text>
          {note && <Text dimColor>{note}</Text>}
          {items.map(r => (
            <Box key={r.id} flexDirection="row" gap={1}>
              <Text color={r.isActive ? 'green' : undefined} dimColor={!r.isActive}>
                {r.isActive ? '●' : '○'}
              </Text>
              <Box flexDirection="column" flexGrow={1}>
                <Text>
                  {r.name} <Text dimColor>· {status(r)}</Text>
                </Text>
                {r.description !== '' && <Text dimColor>{r.description}</Text>}
              </Box>
              {r.name === SELF ? (
                <Text dimColor>this mod</Text>
              ) : r.isEnabled === null ? null : (
                <Button key={`toggle:${r.id}`} onPress={() => toggle($, r)}>
                  {working === r.id ? 'Wait…' : r.isEnabled ? 'Turn off' : 'Turn on'}
                </Button>
              )}
            </Box>
          ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {list.length === 0 && problem === null && <Text dimColor>Reading the list…</Text>}
        {section('mods', 'Claude Mods', 'claude-mods marketplace')}
        {section('session', 'Loaded from a folder', 'They stop when the session ends or the folder is removed')}
        {section('plugins', 'Installed plugins')}
        {problem !== null && <Text color="red">{problem}</Text>}
        <Box flexDirection="row" gap={1}>
          {pending && (
            <Button
              key="reload"
              variant="primary"
              onPress={async () => {
                await $.prompt.fill({ text: '/reload-plugins' })
                $.ui.toast('Press Enter to reload the mods')
              }}
            >
              Reload mods
            </Button>
          )}
          <Button key="refresh" onPress={() => safeRefresh($)}>
            Refresh
          </Button>
          <Button key="close" role="dismiss" onPress={() => $.ui.close({ id: PANE })}>
            Close
          </Button>
        </Box>
      </Box>
    )
  })
}
