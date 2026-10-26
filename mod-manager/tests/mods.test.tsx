import { expect, test } from 'claude-code/testing'

const LIST = [
  { id: 'commit-approve@claude-mods', enabled: true, scope: 'user' },
  { id: 'prompt-coach@claude-mods', enabled: false, scope: 'user' },
  { id: 'mod-manager@claude-mods', enabled: true, scope: 'user' },
  { id: 'superpowers@anthropic-plugin-directory', enabled: true, scope: 'user' },
]

const PANE = {
  plugin: 'mod-manager',
  component: 'Pane',
  requestId: 'mod-manager',
  props: {
    title: 'Mods',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`lists the mods and turns off the chosen one (${surface})`, async ($, on) => {
    const runs: string[][] = []
    const fills: string[] = []
    on('command.register', () => ({ value: { command: 'mods' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('settings.read', () => ({
      value: {
        enabledPlugins: {
          'commit-approve@claude-mods': true,
          'mod-manager@claude-mods': true,
          'superpowers@anthropic-plugin-directory': true,
        },
      },
    }))
    on('fs.read', () => ({ value: '{"description":"test description"}' }))
    on('prompt.fill', (_, e) => (fills.push(e.text), { isFilled: true }))
    on('process.run', (_, e) => {
      runs.push([...e.argv])
      const stdout = e.argv[2] === 'list' ? JSON.stringify(LIST) : ''
      return { value: { exitCode: 0, stdout, stderr: '' } }
    })

    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ command: 'mods', args: '' })

    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Claude Mods/ }))?.text).toBe('Claude Mods')
    expect((await ui.find({ type: 'Text', text: /prompt-coach/ }))?.text).toContain('off')
    expect((await ui.find({ type: 'Text', text: /commit-approve/ }))?.text).toContain('· active')
    expect(await ui.find({ type: 'Text', text: /Installed plugins/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'toggle:mod-manager@claude-mods' })).toBeUndefined()

    await ui.press({ key: 'toggle:commit-approve@claude-mods' })
    expect(runs).toContainEqual(['claude', 'plugin', 'disable', 'commit-approve@claude-mods', '--scope', 'user'])
    expect(fills).toContain('/reload-plugins')
    await ui.unmount()
  })
}
