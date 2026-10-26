export type ModRow = {
  /** `<name>@<marketplace>` for installed plugins, `<name>@inline` for those loaded from a folder. */
  id: string
  name: string
  description: string
  /** Loaded right now in this session. */
  isActive: boolean
  /** Enabled in settings; `null` if it cannot be changed from here (loaded from a folder). */
  isEnabled: boolean | null
  /** `mods` = this marketplace, `plugins` = other installed plugins, `session` = this session only. */
  group: 'mods' | 'plugins' | 'session'
}

declare module 'claude-code' {
  interface PluginState {
    'mod-manager': { rows: ModRow[]; busy: string | null; error: string | null }
  }
}
