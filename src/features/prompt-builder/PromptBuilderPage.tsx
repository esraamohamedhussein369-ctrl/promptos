import { useEffect, useMemo, useState } from 'react'
import { usePromptStore } from '../../application/store/usePromptStore'
import { compilePrompt, validatePrompt } from '../../domain/prompt/compiler'
import { roles } from '../../domain/prompt/roles'

export function PromptBuilderPage() {
  const prompt = usePromptStore((state) => state.prompt)
  const setPrompt = usePromptStore((state) => state.setPrompt)
  const addConstraint = usePromptStore((state) => state.addConstraint)
  const removeConstraint = usePromptStore((state) => state.removeConstraint)
  const addRequirement = usePromptStore((state) => state.addRequirement)
  const removeRequirement = usePromptStore((state) => state.removeRequirement)
  const [constraintDraft, setConstraintDraft] = useState('')
  const [requirementDraft, setRequirementDraft] = useState('')
  const [compiled, setCompiled] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const role = useMemo(() => roles.find((item) => item.id === prompt.roleId), [prompt.roleId])
  const compiledPrompt = useMemo(
    () => (role ? compilePrompt(prompt, role).text : ''),
    [prompt, role],
  )

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        const validation = validatePrompt(prompt)
        if (!validation.valid) {
          setError(validation.errors[0])
          setMessage('')
          return
        }
        setError('')
        setMessage('Prompt compiled. The preview updates as you edit.')
        setCompiled(true)
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [prompt])

  function compile() {
    const validation = validatePrompt(prompt)
    if (!validation.valid) {
      setError(validation.errors[0])
      setMessage('')
      return
    }
    setError('')
    setMessage('Prompt compiled. The preview updates as you edit.')
    setCompiled(true)
  }

  async function copyPrompt() {
    if (!compiledPrompt) return
    try {
      await navigator.clipboard.writeText(compiledPrompt)
      setError('')
      setMessage('Compiled prompt copied to clipboard.')
    } catch (copyError) {
      console.error('PromptOS could not copy the compiled prompt.', copyError)
      setMessage('')
      setError('Clipboard access was denied. Select and copy the preview manually.')
    }
  }

  function addDraft(kind: 'constraint' | 'requirement') {
    if (kind === 'constraint') {
      addConstraint(constraintDraft)
      setConstraintDraft('')
    } else {
      addRequirement(requirementDraft)
      setRequirementDraft('')
    }
  }

  return (
    <section className="page">
      <header className="page-header compact">
        <div>
          <p className="eyebrow">BUILD / PROMPT BUILDER</p>
          <h1>Structure the instruction.</h1>
          <p className="lede">Define the conditions before asking the model to perform.</p>
        </div>
        <button className="button primary" onClick={compile}>Compile <span>⌘↵</span></button>
      </header>

      <div className="builder-layout">
        <section className="panel">
          <div className="panel-header">
            <div><span className="step">01</span><div><h2>Configuration</h2><p>Give the AI a precise operating context.</p></div></div>
          </div>

          <label className="field">
            <span>Prompt name</span>
            <input value={prompt.name} onChange={(event) => setPrompt({ name: event.target.value })} maxLength={120} placeholder="Untitled Prompt" />
          </label>

          <label className="field">
            <span>Engineering role</span>
            <select value={prompt.roleId ?? ''} onChange={(event) => setPrompt({ roleId: event.target.value || null })}>
              <option value="">Select a role</option>
              {roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>

          <label className="field">
            <span>Objective <small>What must be accomplished?</small></span>
            <textarea value={prompt.objective} onChange={(event) => setPrompt({ objective: event.target.value })} placeholder="Example: Review the authentication flow and identify security and maintainability risks." rows={5} />
          </label>

          <label className="field">
            <span>Context <small>What does the model need to know?</small></span>
            <textarea value={prompt.context} onChange={(event) => setPrompt({ context: event.target.value })} placeholder="Example: React + TypeScript application using cookie-based sessions..." rows={6} />
          </label>

          <div className="field">
            <span>Constraints <small>What must not happen?</small></span>
            <div className="chip-list">
              {prompt.constraints.map((constraint, index) => (
                <button className="chip" key={`${constraint}-${index}`} onClick={() => removeConstraint(index)} aria-label={`Remove constraint: ${constraint}`}>
                  {constraint} ×
                </button>
              ))}
            </div>
            <div className="inline-input">
              <input value={constraintDraft} onChange={(event) => setConstraintDraft(event.target.value)} placeholder="No new dependencies" onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addDraft('constraint')
                }
              }} />
              <button className="button secondary" onClick={() => addDraft('constraint')}>Add</button>
            </div>
          </div>

          <div className="field">
            <span>Requirements <small>What must the response include?</small></span>
            <div className="chip-list">
              {prompt.requirements.map((requirement, index) => (
                <button className="chip" key={`${requirement}-${index}`} onClick={() => removeRequirement(index)} aria-label={`Remove requirement: ${requirement}`}>
                  {requirement} ×
                </button>
              ))}
            </div>
            <div className="inline-input">
              <input value={requirementDraft} onChange={(event) => setRequirementDraft(event.target.value)} placeholder="Include regression tests" onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addDraft('requirement')
                }
              }} />
              <button className="button secondary" onClick={() => addDraft('requirement')}>Add</button>
            </div>
          </div>

          <label className="field">
            <span>Output contract <small>What should the response look like?</small></span>
            <textarea value={prompt.outputFormat} onChange={(event) => setPrompt({ outputFormat: event.target.value })} placeholder="1. Findings&#10;2. Root cause&#10;3. Risks&#10;4. Recommended fix&#10;5. Tests" rows={7} />
          </label>

          {error && <div className="alert error" role="alert">{error}</div>}
          {message && <div className="alert success" role="status">{message}</div>}
        </section>

        <section className="panel preview-panel">
          <div className="panel-header">
            <div><span className="step">02</span><div><h2>Compiled prompt</h2><p>Deterministic output from your current configuration.</p></div></div>
            <button className="button ghost" onClick={copyPrompt} disabled={!compiled}>{'Copy'}</button>
          </div>
          {compiled ? (
            <pre className="prompt-preview"><code>{compiledPrompt}</code></pre>
          ) : (
            <div className="empty-preview">
              <div className="empty-icon">✦</div>
              <strong>Nothing compiled yet.</strong>
              <p>Define the objective and role, then compile your first engineering prompt.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
