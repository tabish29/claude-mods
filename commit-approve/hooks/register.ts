import type { Register } from 'claude-code'

const RULES = `Commit messages (commit-approve mod): when you finish a task that changed files in a git repository, propose a commit right away: stage the relevant files with \`git add\`, then run \`git commit -m '<message>'\` with a single -m. The message is in English, follows Conventional Commits (\`type(scope): summary\`, type one of feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert; scope optional), is exactly one sentence describing what was done, imperative mood, lowercase after the colon, no trailing period, no body, and no Co-Authored-By or any other trailer. Always pass the message with a quoted -m: -F, --file, -C, the editor and unquoted messages are refused because they skip the approval. Prefer one git commit per command; if you chain several, each one needs its own single -m and is approved separately. The user approves or changes the message in a dialog before the commit runs; if the commit is denied, do not retry unless the user asks.`

const REWRITE = `You rewrite git commit messages. Output only the new message, nothing else: English, Conventional Commits (type(scope): summary), one sentence, imperative mood, lowercase after the colon, no trailing period, no body, no trailers. Apply the user's request to the current message; if the request is written in another language, still answer in English.`

const NO_MESSAGE = `commit-approve: this git commit has no readable -m message (-F, --file, -C, the editor or an unquoted message skip the approval), so it did not run. Run it again with a quoted -m '<type(scope): summary>' and nothing else.`

// A `git commit` in command position: at the start of the command or after && || ; | ( ` or a newline,
// behind any VAR=value prefix, with git's own options (-C <dir>, -c <key=value>) allowed.
// Text inside a quoted string (echo 'git commit') is not in command position and does not match.
const GIT_COMMIT = /(?:^|[;&|(`\n])\s*(?:\w+=\S*\s+)*(git\s+(?:(?:-[cC]|--git-dir|--work-tree)\s+\S+\s+|-\S+\s+)*commit)\b/
// Commits that do not write a new message, so there is nothing to approve.
const NO_MESSAGE_NEEDED = /(?:^|\s)(?:--no-edit|--dry-run|--help|-h)(?:\s|$)/
const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: \S/

type Span = { start: number; end: number; text: string; keep: string }
type Commit = { start: number; end: number; spans: Span[] }
type Edit = { start: number; end: number; text: string }

// Every -m / --message / -am style option with a quoted value. `keep` is what must stay of the flag
// when it is a cluster such as -am (the -a).
const findMessages = (cmd: string): Span[] => {
  const spans: Span[] = []
  const flag = String.raw`(\s)(-[a-zA-Z]*m|--message)(?:\s+|=)`
  const patterns: [RegExp, (m: RegExpExecArray) => string][] = [
    [new RegExp(flag + String.raw`"\$\(cat <<-?'?(\w+)'?\n([\s\S]*?)\n\s*\3\s*\)"`, 'g'), m => m[4]],
    [new RegExp(flag + String.raw`"((?:[^"\\]|\\.)*)"`, 'g'), m => m[3].replace(/\\(["\\$`])/g, '$1')],
    [new RegExp(flag + String.raw`'([^']*)'`, 'g'), m => m[3]],
  ]
  for (const [re, text] of patterns)
    for (let m = re.exec(cmd); m; m = re.exec(cmd)) {
      const start = m.index + m[1].length
      const end = m.index + m[0].length
      const keep = m[2].startsWith('--') || m[2] === '-m' ? '' : m[2].slice(0, -1)
      if (!spans.some(s => start < s.end && end > s.start)) spans.push({ start, end, text: text(m), keep })
    }
  return spans.sort((a, b) => a.start - b.start)
}

// The bodies of heredocs (cat > file <<'EOF' ... EOF). Their lines are data, not commands, so a `git commit`
// written in one (a README example, a script being created) is never a commit. A heredoc that is the
// value of an -m (-m "$(cat <<'EOF' ...)") is a message span and is handled there, not here.
const findHeredocs = (cmd: string, spans: Span[]): [number, number][] => {
  const bodies: [number, number][] = []
  const re = /<<-?[ \t]*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g
  for (let m = re.exec(cmd); m; m = re.exec(cmd)) {
    if (spans.some(s => m!.index >= s.start && m!.index < s.end)) continue
    const start = m.index + m[0].indexOf('\n') + 1
    bodies.push([start, m.index + m[0].length])
    re.lastIndex = m.index + m[0].length
  }
  return bodies
}

// Each git commit of the command with the messages that belong to it. A commit runs up to the next
// && || ; | or newline that is not inside a message, so an -m of another command (mkdir -m "755")
// is never taken for a commit message and chained commits keep their own messages.
const findCommits = (cmd: string, spans: Span[]): Commit[] => {
  const commits: Commit[] = []
  const heredocs = findHeredocs(cmd, spans)
  const re = new RegExp(GIT_COMMIT.source, 'g')
  for (let m = re.exec(cmd); m; m = re.exec(cmd)) {
    const start = m.index + m[0].length - m[1].length
    if (spans.some(s => start >= s.start && start < s.end)) continue
    if (heredocs.some(([from, to]) => start >= from && start < to)) continue
    let end = cmd.length
    for (let i = start; i < cmd.length; i++) {
      const s = spans.find(x => i >= x.start && i < x.end)
      if (s) {
        i = s.end - 1
        continue
      }
      if (';|&\n'.includes(cmd[i])) {
        end = i
        break
      }
    }
    commits.push({ start, end, spans: spans.filter(s => s.start >= start && s.end <= end) })
  }
  return commits
}

const clean = (text: string): string =>
  (text
    .split('\n')
    .map(l => l.trim())
    .find(l => l !== '' && !/^[\w-]+:\s.*<.*>$/.test(l) && !/^co-authored-by:/i.test(l)) ?? '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\.$/, '')

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// The first message of a commit becomes the only -m; the other messages are removed, and so is the
// whitespace before them. Other letters of a cluster (-am) stay as their own flag.
const editsFor = (cmd: string, c: Commit, msg: string): Edit[] =>
  c.spans.map((s, i) => {
    if (i === 0) return { start: s.start, end: s.end, text: `${s.keep ? `${s.keep} ` : ''}-m ${quote(msg)}` }
    if (s.keep) return { start: s.start, end: s.end, text: s.keep }
    const gap = /\s*$/.exec(cmd.slice(c.spans[i - 1].end, s.start))?.[0].length ?? 0
    return { start: s.start - gap, end: s.end, text: '' }
  })

const apply = (cmd: string, edits: Edit[]): string => {
  let out = ''
  let at = 0
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    out += cmd.slice(at, e.start) + e.text
    at = e.end
  }
  return out + cmd.slice(at)
}

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { sections: [...r.sections, { id: 'commit-approve:rules', text: RULES, scope: 'session' }] }
  })

  on('attribution.text', { kind: 'commit' }, () => ({ text: '' }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const spans = findMessages(e.command)
    const commits = findCommits(e.command, spans)
    if (commits.length === 0) return next(e)

    // Asks until the user approves; resolves to the approved message, or to the reason it must not run.
    const approve = async (first: string, label: string): Promise<{ msg: string } | { deny: string }> => {
      let msg = first
      for (;;) {
        let answer: string
        try {
          answer = await $.ui.ask(
            `${label}Proposed commit message:\n\n    ${msg}\n\nApprove it, or choose Other and write how to change it (or the exact message to use)?`,
            { header: 'Commit', options: ['Approve', 'Cancel'] },
          )
        } catch {
          return { deny: 'The user dismissed the commit approval; the commit did not run. Do not retry unless asked.' }
        }
        if (answer === 'Approve') return { msg }
        if (answer === 'Cancel') return { deny: 'The user cancelled this commit; it did not run. Do not retry unless asked.' }

        const typed = answer.trim()
        if (CONVENTIONAL.test(typed)) {
          msg = clean(typed)
          continue
        }
        $.ui.status('commit-approve: rewriting message…')
        const r = await $.model.complete({
          model: 'haiku',
          system: REWRITE,
          prompt: `Current message: ${msg}\nUser request: ${typed}`,
          maxTokens: 200,
          effort: 'low',
          timeoutMs: 20000,
        })
        $.ui.status(undefined)
        if (r.isAnswered && clean(r.text) !== '') msg = clean(r.text)
        else $.ui.toast('Could not rewrite the message; showing the previous one.')
      }
    }

    // Every commit is checked before any is allowed: a refusal or a cancel anywhere stops the whole command.
    const edits: Edit[] = []
    for (const [n, c] of commits.entries()) {
      if (c.spans.length === 0) {
        if (NO_MESSAGE_NEEDED.test(e.command.slice(c.start, c.end))) continue
        return { deny: NO_MESSAGE }
      }
      const first = clean(c.spans[0].text)
      if (first === '') return { deny: 'commit-approve: the commit message is empty, so the commit did not run.' }
      const label = commits.length > 1 ? `Commit ${n + 1} of ${commits.length}\n\n` : ''
      const result = await approve(first, label)
      if ('deny' in result) return result
      edits.push(...editsFor(e.command, c, result.msg))
    }
    return next(edits.length === 0 ? e : { ...e, command: apply(e.command, edits) })
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'commit-approve: the approval step failed, so the commit did not run.' },
  )
}
