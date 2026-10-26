export type PromptRole = {
  id: string
  name: string
  description: string
  responsibilities: string[]
  rules: string[]
  defaultConstraints: string[]
  outputContract: string
}

export type Prompt = {
  id: string
  name: string
  roleId: string | null
  objective: string
  context: string
  constraints: string[]
  requirements: string[]
  outputFormat: string
  createdAt: string
  updatedAt: string
}

export type CompiledPrompt = {
  text: string
  sections: Array<{ title: string; content: string }>
}

export type PromptValidation = {
  valid: boolean
  errors: string[]
}
