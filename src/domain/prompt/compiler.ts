import type { CompiledPrompt, Prompt, PromptRole } from './types'

function clean(value: string) {
  return value.trim().replace(/\n{3,}/g, '\n\n')
}

export function validatePrompt(prompt: Prompt): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!clean(prompt.objective)) errors.push('Objective is required.')
  if (!clean(prompt.context)) errors.push('Context is recommended before compilation.')
  if (!prompt.roleId) errors.push('Select an engineering role.')
  return { valid: errors.length === 0, errors }
}

export function compilePrompt(prompt: Prompt, role: PromptRole): CompiledPrompt {
  const sections = [
    { title: 'ROLE', content: `You are a ${role.name}. ${role.description}` },
    { title: 'RESPONSIBILITIES', content: role.responsibilities.map((x) => `- ${x}`).join('\n') },
    { title: 'OBJECTIVE', content: clean(prompt.objective) },
    { title: 'CONTEXT', content: clean(prompt.context) || 'No additional context provided.' },
    {
      title: 'CONSTRAINTS',
      content: [...role.defaultConstraints, ...prompt.constraints].filter(Boolean).map((x) => `- ${x}`).join('\n') || '- None specified.',
    },
    {
      title: 'REQUIREMENTS',
      content: prompt.requirements.filter(Boolean).map((x) => `- ${x}`).join('\n') || '- None specified.',
    },
    { title: 'OUTPUT CONTRACT', content: clean(prompt.outputFormat) || role.outputContract },
    { title: 'ENGINEERING RULES', content: role.rules.map((x) => `- ${x}`).join('\n') },
  ]

  const text = sections.map(({ title, content }) => `${title}\n${content}`).join('\n\n')
  return { text, sections }
}