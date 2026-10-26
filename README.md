# claudeMods

A collection of mods (plugins) for [Claude Code](https://claude.com/claude-code). This repository is a **plugin marketplace**: add it to Claude Code once, then install only the mods you want.

## Included mods

| Mod | What it does |
| --- | --- |
| `commit-approve` | After each task, proposes a one-line Conventional Commits message (in English) and asks you to approve or change it before `git commit` runs. Refuses commits that would skip the approval. |
| `prompt-coach` | Judges every prompt: if it is too vague, asks targeted multiple-choice questions, rewrites it into an optimized prompt, then carries out the task. Toggle with `/prompt-coach on\|off\|status`. |
| `mod-manager` | Adds a `/mods` command: lists mods and plugins, shows which are active in the session, and turns them on or off. |

## Installation

Inside Claude Code, add this repository as a marketplace:

```
/plugin marketplace add tabish29/claude-mods
```

Then install the mods you want (one or all):

```
/plugin install commit-approve@claude-mods
/plugin install prompt-coach@claude-mods
/plugin install mod-manager@claude-mods
```

Finally reload plugins without restarting:

```
/reload-plugins
```

You can also run `/plugin` to open the interactive menu, pick the `claude-mods` marketplace and install from there.

### Installing from a local clone

```
git clone https://github.com/tabish29/claude-mods.git
```

```
/plugin marketplace add /absolute/path/to/the/clone
```

then run the same `/plugin install ...@claude-mods` commands.

## Usage

- **commit-approve**: works automatically. When Claude finishes a task that changed files in a git repository, it shows a dialog with the proposed commit message. You can approve it, change it, or deny the commit.
- **prompt-coach**: works automatically. If your prompt is clear you see nothing; if it is vague you get targeted questions and an "Optimized prompt" before the task starts.
- **mod-manager**: type `/mods` to open the panel and turn mods on or off.

## Updating and removing

```
/plugin marketplace update claude-mods
/plugin uninstall <mod-name>@claude-mods
/plugin marketplace remove claude-mods
```

## Other mods worth installing (not included)

These live in their own repositories:

```
/plugin marketplace add anthropics/claude-plugins-official
/plugin install frontend-design@claude-plugins-official
```

```
/plugin marketplace add data-goblin/claude-code-filetree
/plugin install filetree@claude-code-filetree
```

`superpowers` ([github.com/obra/superpowers](https://github.com/obra/superpowers)) is available from the Anthropic plugin directory.

## Repository layout

```
.claude-plugin/marketplace.json   list of the marketplace's plugins
commit-approve/                   hook module (TypeScript)
prompt-coach/                     hook module (TypeScript)
mod-manager/                      /mods panel (TSX)
```

Each mod folder contains `.claude-plugin/plugin.json` and a `hooks/register.*` module.

## Customizing

The `commit-approve` rules (English message, one line, no co-author trailer) are opinionated: edit `commit-approve/hooks/register.ts` if you want different rules.

## License

[MIT](LICENSE)
