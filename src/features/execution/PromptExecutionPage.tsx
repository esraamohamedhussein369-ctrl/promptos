import { useEffect, useMemo, useState } from 'react'
import { usePromptStore } from '../../application/store/usePromptStore'
import { useAuth } from '../../application/auth/AuthContext'
import {
  evaluateResponse,
  executePrompt,
  getProviderStatus,
  AiRequestError,
  type AiEvaluation,
  type AiExecution,
  type ProviderStatus,
} from '../../application/ai/aiClient'
import {
  loadAiRunRecords,
  markAiRunEvaluated,
  saveAiRunRecord,
  type AiRunRecord,
} from '../../application/persistence/aiAnalytics'
import { compilePrompt, validatePrompt } from '../../domain/prompt/compiler'
import { roles } from '../../domain/prompt/roles'

function createRecordId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function PromptExecutionPage() {
  const prompt = usePromptStore((state) => state.prompt)
  const { quota: userQuota, updateQuota } = useAuth()
  const role = useMemo(() => roles.find((item) => item.id === prompt.roleId), [prompt.roleId])
  const compiledPrompt = useMemo(
    () => (role ? compilePrompt(prompt, role).text : ''),
    [prompt, role],
  )
  const validation = validatePrompt(prompt)
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [providerError, setProviderError] = useState('')
  const [userInput, setUserInput] = useState('Carry out the objective in the system instructions and follow the requested output format.')
  const [execution, setExecution] = useState<AiExecution | null>(null)
  const [evaluation, setEvaluation] = useState<AiEvaluation | null>(null)
  const [executionPrompt, setExecutionPrompt] = useState('')
  const [executionRecordId, setExecutionRecordId] = useState('')
  const [records, setRecords] = useState<AiRunRecord[]>(() =>
    typeof window === 'undefined' ? [] : loadAiRunRecords(),
  )
  const [isCheckingProvider, setIsCheckingProvider] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getProviderStatus()
      .then((status) => {
        if (active) {
          setProvider(status)
          setProviderError('')
        }
      })
      .catch((cause: unknown) => {
        if (active) setProviderError(cause instanceof Error ? cause.message : 'Could not check AI server status.')
      })
      .finally(() => {
        if (active) setIsCheckingProvider(false)
      })

    return () => {
      active = false
    }
  }, [])

  async function runPrompt() {
    if (!provider?.configured || !validation.valid || !userInput.trim()) return

    setIsRunning(true)
    setError('')
    setEvaluation(null)
    try {
      const result = await executePrompt(compiledPrompt, userInput)
      if (result.quota) updateQuota(result.quota)
      const record: AiRunRecord = {
        id: createRecordId(),
        createdAt: new Date().toISOString(),
        durationMs: result.durationMs,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        outcome: 'completed',
      }
      saveAiRunRecord(record)
      setRecords(loadAiRunRecords())
      setExecution(result)
      setExecutionPrompt(compiledPrompt)
      setExecutionRecordId(record.id)
    } catch (cause) {
      if (cause instanceof AiRequestError && cause.quota) updateQuota(cause.quota)
      setError(cause instanceof Error ? cause.message : 'The AI request failed.')
    } finally {
      setIsRunning(false)
    }
  }

  async function runEvaluation() {
    if (!execution || !executionPrompt) return

    setIsEvaluating(true)
    setError('')
    try {
      const result = await evaluateResponse(executionPrompt, execution.content)
      if (result.quota) updateQuota(result.quota)
      markAiRunEvaluated(executionRecordId, {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        durationMs: result.durationMs,
      })
      setRecords(loadAiRunRecords())
      setEvaluation(result)
    } catch (cause) {
      if (cause instanceof AiRequestError && cause.quota) updateQuota(cause.quota)
      setError(cause instanceof Error ? cause.message : 'The evaluation failed.')
    } finally {
      setIsEvaluating(false)
    }
  }

  const evaluatedCount = records.filter((record) => record.outcome === 'evaluated').length
  const averageDuration =
    records.length > 0
      ? Math.round(records.reduce((total, record) => total + record.durationMs, 0) / records.length)
      : null
  const totalTokens = records.reduce(
    (total, record) =>
      total +
      (record.totalTokens ?? (record.promptTokens ?? 0) + (record.completionTokens ?? 0)) +
      (record.evaluationTotalTokens ??
        (record.evaluationPromptTokens ?? 0) + (record.evaluationCompletionTokens ?? 0)),
    0,
  )

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">PROMPT EXECUTION</span>
          <h1>Run it. Review the response.</h1>
          <p className="lede">Send your compiled prompt through the server-side AI provider, then ask the model to assess its answer against your instructions.</p>
        </div>
        <div className={`provider-status ${provider?.configured ? 'provider-ready' : 'provider-offline'}`} role="status">
          <span className="status-dot" />
          {isCheckingProvider
            ? 'Checking AI server'
            : provider?.configured
              ? `${provider.provider} · ${provider.model}`
              : 'AI provider not configured'}
        </div>
      </header>

      {providerError && <div className="alert error" role="alert">{providerError}</div>}
      {!isCheckingProvider && provider && !provider.configured && (
        <div className="alert info" role="status">
          Add <code>OPENAI_API_KEY</code> to the backend <code>.env</code> file and restart PromptOS. The key is never entered into or stored in the browser.
        </div>
      )}

      <section className="execution-analytics" aria-label="Local usage analytics">
        <article className="metric-card"><span>AI runs saved</span><strong>{records.length}</strong><small>Latest 100 runs · this browser only</small></article>
        <article className="metric-card"><span>Responses evaluated</span><strong>{evaluatedCount}</strong><small>Model-based review</small></article>
        <article className="metric-card"><span>Average run latency</span><strong>{averageDuration === null ? '—' : `${(averageDuration / 1000).toFixed(1)}s`}</strong><small>Successful prompt runs</small></article>
        <article className="metric-card"><span>Tokens used</span><strong>{totalTokens.toLocaleString()}</strong><small>Runs and evaluations, when reported</small></article>
      </section>
      {userQuota && (
        <div className={`quota-callout ${userQuota.remaining === 0 ? 'quota-empty' : ''}`} role="status">
          Today: {userQuota.used} of {userQuota.limit} AI requests used ({userQuota.remaining} remaining). Runs and response evaluations both count.
        </div>
      )}
      <p className="analytics-note">Analytics store counts, timing, and token totals only—never prompt text or AI responses. Evaluations use an additional provider call. Usage data is local to this browser and is not a provider billing report.</p>

      <div className="execution-layout">
        <section className="panel">
          <div className="panel-heading">
            <div><span className="eyebrow">REQUEST</span><h2>What should the AI do?</h2></div>
          </div>
          <label className="field">
            <span>User message <small>Additional detail sent alongside the compiled prompt</small></span>
            <textarea className="text-area" value={userInput} onChange={(event) => setUserInput(event.target.value)} rows={5} maxLength={30_000} />
          </label>
          {!validation.valid && (
            <div className="alert error" role="alert">
              Complete the builder first: {validation.errors.join(' ')}
            </div>
          )}
          <div className="execution-actions">
            <button
              className="button primary"
              onClick={runPrompt}
              disabled={!provider?.configured || !validation.valid || !userInput.trim() || isRunning || isCheckingProvider}
            >
              {isRunning ? 'Waiting for AI…' : 'Run prompt'}
            </button>
            <span className="muted">The provider receives the compiled prompt and the message above.</span>
          </div>
          {error && <div className="alert error" role="alert">{error}</div>}
        </section>

        <section className="panel response-panel" aria-live="polite">
          <div className="panel-heading">
            <div><span className="eyebrow">AI RESPONSE</span><h2>{execution ? `Response · ${execution.model}` : 'Ready to run'}</h2></div>
          </div>
          {execution ? (
            <>
              <pre className="ai-response">{execution.content}</pre>
              <div className="response-meta">
                <span>{(execution.durationMs / 1000).toFixed(1)}s response time</span>
                <span>{execution.usage.totalTokens === null ? 'Token usage unavailable' : `${execution.usage.totalTokens.toLocaleString()} tokens`}</span>
              </div>
              <button className="button secondary" onClick={runEvaluation} disabled={isEvaluating}>
                {isEvaluating ? 'Evaluating response…' : 'Evaluate against prompt'}
              </button>
            </>
          ) : (
            <div className="empty-state">
              <strong>Your response will appear here.</strong>
              <p>PromptOS sends requests through the configured server; the API key is not sent to this browser.</p>
            </div>
          )}
        </section>

        {evaluation && (
          <section className="panel evaluation-panel">
            <div className="panel-heading">
              <div><span className="eyebrow">AI EVALUATION</span><h2>Instruction alignment</h2></div>
              <strong className="evaluation-score">{evaluation.score}<small>/100</small></strong>
            </div>
            <p className="evaluation-summary">{evaluation.summary}</p>
            <p className="evaluation-disclaimer">Model-generated estimate, not a guarantee of factual correctness. Review important results yourself.</p>
            <div className="evaluation-columns">
              <div><h3>Strengths</h3><ul>{evaluation.strengths.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>
              <div><h3>Improve next</h3><ul>{evaluation.improvements.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>
            </div>
            {evaluation.criteria.length > 0 && (
              <div className="criteria-list">
                {evaluation.criteria.map((item, index) => (
                  <article className={`criterion criterion-${item.status}`} key={`${index}-${item.criterion}`}>
                    <div><strong>{item.criterion}</strong><span>{item.status}</span></div>
                    <p>{item.reason}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </section>
  )
}
