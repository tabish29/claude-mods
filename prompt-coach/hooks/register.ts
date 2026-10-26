import type { Register } from 'claude-code'

const KEY = 'enabled'

const COACH = `# Prompt coach

Before acting on each new task request from the user, silently make a quick judgement (a few seconds, not an essay) of whether the prompt gives you enough to do the task well. Judge it on: a clear goal, the expected output (format, length, where it goes), the relevant context (audience, tech stack, files, constraints), and success criteria.

- If the prompt is clear enough, or it is a follow-up, a short answer to your question, a confirmation, a slash command, or a trivial request, do NOT mention this check: just do the task.
- If the prompt is too vague or underspecified, so that a good result depends on guesses you would likely get wrong, do not start the task. Instead:
  1. Call AskUserQuestion with 1–4 targeted multiple-choice questions covering only the gaps that most change the result (goal, output format, scope, audience, constraints, quality bar). Give each 2–4 concrete, distinct options, put the one you recommend first marked "(Recommended)", and write questions and options in the user's language.
  2. With the answers, rewrite the prompt into an optimized version that gets the most out of an LLM: a clear role and objective, the context, explicit requirements and constraints, the expected output format, and success criteria. Show it to the user under a heading such as "Optimized prompt" in a quoted or fenced block.
  3. Then carry out the task by following the optimized prompt, without asking for a further confirmation unless the task is risky or irreversible.
- Never ask about things you can find out yourself from the code, files, or context; never run this check more than once for the same task.`

async function isEnabled($: { store: { get: (key: string) => Promise<unknown> } }) {
  return (await $.store.get(KEY)) !== false
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prompt-coach',
      description: 'Turn the prompt coach on or off (on | off | status)',
    })
    $.ui.status((await isEnabled($)) ? 'prompt-coach: on' : undefined)

    return next(e)
  })

  on('command.run', { command: 'prompt-coach' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    let enabled = await isEnabled($)
    if (arg === 'on') enabled = true
    else if (arg === 'off') enabled = false
    else if (arg !== 'status') enabled = !enabled
    await $.store.set(KEY, enabled)
    $.ui.status(enabled ? 'prompt-coach: on' : undefined)

    return { text: `Prompt coach ${enabled ? 'enabled' : 'disabled'}.` }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await isEnabled($)) || !e.tools.includes('AskUserQuestion')) return composed

    return {
      sections: [...composed.sections, { id: 'prompt-coach:rules', text: COACH, scope: 'session' }],
    }
  })
}
