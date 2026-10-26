import { expect, test } from 'claude-code/testing'

// Answers each approval question with the next pick (the last one repeats) and records the questions
// asked and the Bash commands that reached the shell after the mod.
const run = (picks: string[]) => {
  const asked: string[] = []
  const ran: string[] = []
  let n = 0
  const hook = (_: unknown, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      asked.push(e.questions[0].question)
      const pick = picks[Math.min(n++, picks.length - 1)]
      return { result: { questions: e.questions, answers: { [e.questions[0].question]: pick } } }
    }
    if (e.tool === 'Bash') ran.push(e.command)
    return { result: { stdout: e.command, stderr: '' } }
  }
  return { asked, ran, hook }
}

const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })

test('an approved heredoc commit runs as one -m with no trailer', async ($, on) => {
  const t = run(['Approve'])
  on('tool.call', t.hook)
  await bash(
    $,
    `git add . && git commit -m "$(cat <<'EOF'\nfeat(api): add login endpoint.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nEOF\n)"`,
  )
  expect(t.ran).toEqual([`git add . && git commit -m 'feat(api): add login endpoint'`])
})

test('a cancelled commit never runs', async ($, on) => {
  const t = run(['Cancel'])
  on('tool.call', t.hook)
  await bash($, `git commit -m "fix: typo"`)
  expect(t.ran).toEqual([])
})

test('a second -m (the body) is dropped', async ($, on) => {
  const t = run(['Approve'])
  on('tool.call', t.hook)
  await bash($, `git commit -m "docs: add design" -m "A long description."`)
  expect(t.ran).toEqual([`git commit -m 'docs: add design'`])
})

test('chained commits each keep their own message and are approved one by one', async ($, on) => {
  const t = run(['Approve'])
  on('tool.call', t.hook)
  await bash(
    $,
    `git add a && git commit -q -m "docs: first" -m "body one" && git add b && git commit -q -m "docs: second" -m "body two"`,
  )
  expect(t.asked.length).toBe(2)
  expect(t.asked[0]).toContain('docs: first')
  expect(t.asked[1]).toContain('docs: second')
  expect(t.ran).toEqual([`git add a && git commit -q -m 'docs: first' && git add b && git commit -q -m 'docs: second'`])
})

test('cancelling any commit of a chain stops the whole command', async ($, on) => {
  const t = run(['Approve', 'Cancel'])
  on('tool.call', t.hook)
  await bash($, `git commit -m "docs: first" && git commit --allow-empty -m "docs: second"`)
  expect(t.ran).toEqual([])
})

test('-am keeps the -a flag', async ($, on) => {
  const t = run(['Approve'])
  on('tool.call', t.hook)
  await bash($, `git commit -am "fix: typo"`)
  expect(t.ran).toEqual([`git commit -a -m 'fix: typo'`])
})

test('--message= and git options before commit are understood', async ($, on) => {
  const t = run(['Approve'])
  on('tool.call', t.hook)
  await bash($, `git -C repo -c user.name=x commit --message="chore: bump"`)
  expect(t.asked.length).toBe(1)
  expect(t.ran).toEqual([`git -C repo -c user.name=x commit -m 'chore: bump'`])
})

test('a commit without -m is refused, not skipped', async ($, on) => {
  const t = run(['Approve'])
  on('tool.call', t.hook)
  await bash($, `git commit -F msg.txt`)
  await bash($, `git commit --file=msg.txt`)
  await bash($, `git commit -C HEAD~1`)
  await bash($, `git add . && git commit`)
  await bash($, `git commit -m unquoted`)
  expect(t.asked).toEqual([])
  expect(t.ran).toEqual([])
})

test('a refused commit in a chain stops the other commits too', async ($, on) => {
  const t = run(['Approve'])
  on('tool.call', t.hook)
  await bash($, `git commit -m "docs: first" && git commit -F msg.txt`)
  expect(t.ran).toEqual([])
})

test('commits that write no new message run without a dialog', async ($, on) => {
  const t = run(['Approve'])
  on('tool.call', t.hook)
  await bash($, `git commit --amend --no-edit`)
  await bash($, `git commit --dry-run`)
  expect(t.asked).toEqual([])
  expect(t.ran).toEqual([`git commit --amend --no-edit`, `git commit --dry-run`])
})

test('text that only mentions git commit is left alone', async ($, on) => {
  const t = run(['Approve'])
  on('tool.call', t.hook)
  await bash($, `echo "run git commit later" && git log --grep="git commit"`)
  expect(t.asked).toEqual([])
  expect(t.ran).toEqual([`echo "run git commit later" && git log --grep="git commit"`])
})

test('a message that contains git commit and && is one commit', async ($, on) => {
  const t = run(['Approve'])
  on('tool.call', t.hook)
  await bash($, `git commit -m "fix: stop running git commit && push"`)
  expect(t.asked.length).toBe(1)
  expect(t.ran).toEqual([`git commit -m 'fix: stop running git commit && push'`])
})

test('an -m of another command is not a commit message', async ($, on) => {
  const t = run(['Approve'])
  on('tool.call', t.hook)
  await bash($, `git commit -m "chore: x" && mkdir -m "755" d`)
  expect(t.asked.length).toBe(1)
  expect(t.ran).toEqual([`git commit -m 'chore: x' && mkdir -m "755" d`])
})

test('a typed conventional message replaces the proposal', async ($, on) => {
  const t = run(['docs: add the database design', 'Approve'])
  on('tool.call', t.hook)
  await bash($, `git commit -m "docs: wip"`)
  expect(t.ran).toEqual([`git commit -m 'docs: add the database design'`])
})
