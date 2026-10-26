const KEY = 'promptos.ai-analytics.v1'
const MAX_RECORDS = 100
let activeOwnerId: string | null = null

export function setAiAnalyticsOwner(ownerId: string | null) {
  activeOwnerId = ownerId
}

function storageKey() {
  return activeOwnerId ? `${KEY}.${activeOwnerId}` : KEY
}

export type AiRunRecord = {
  id: string
  createdAt: string
  durationMs: number
  promptTokens: number | null
  completionTokens: number | null
  totalTokens?: number | null
  evaluationPromptTokens?: number | null
  evaluationCompletionTokens?: number | null
  evaluationTotalTokens?: number | null
  evaluationDurationMs?: number | null
  outcome: 'completed' | 'evaluated'
}

export function loadAiRunRecords(): AiRunRecord[] {
  try {
    const raw = window.localStorage.getItem(storageKey())
    if (!raw) return []
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) {
      console.error('PromptOS could not load AI analytics: stored data has an invalid format.')
      return []
    }

    return value.filter(
      (record): record is AiRunRecord =>
        !!record &&
        typeof record === 'object' &&
        typeof record.id === 'string' &&
        typeof record.createdAt === 'string' &&
        Number.isFinite(record.durationMs) &&
        (record.promptTokens === null || Number.isFinite(record.promptTokens)) &&
        (record.completionTokens === null || Number.isFinite(record.completionTokens)) &&
        (record.totalTokens === undefined || record.totalTokens === null || Number.isFinite(record.totalTokens)) &&
        (record.evaluationPromptTokens === undefined || record.evaluationPromptTokens === null || Number.isFinite(record.evaluationPromptTokens)) &&
        (record.evaluationCompletionTokens === undefined || record.evaluationCompletionTokens === null || Number.isFinite(record.evaluationCompletionTokens)) &&
        (record.evaluationTotalTokens === undefined || record.evaluationTotalTokens === null || Number.isFinite(record.evaluationTotalTokens)) &&
        (record.evaluationDurationMs === undefined || record.evaluationDurationMs === null || Number.isFinite(record.evaluationDurationMs)) &&
        (record.outcome === 'completed' || record.outcome === 'evaluated'),
    ).slice(0, MAX_RECORDS)
  } catch (error) {
    console.error('PromptOS could not load AI analytics.', error)
    return []
  }
}

export function saveAiRunRecord(record: AiRunRecord) {
  try {
    const records = [record, ...loadAiRunRecords()].slice(0, MAX_RECORDS)
    window.localStorage.setItem(storageKey(), JSON.stringify(records))
    return true
  } catch (error) {
    console.error('PromptOS could not save local AI analytics.', error)
    return false
  }
}

export function markAiRunEvaluated(
  id: string,
  evaluation: {
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
    durationMs: number
  },
) {
  try {
    const records = loadAiRunRecords()
    const updated = records.map((record) =>
      record.id === id
        ? {
            ...record,
            evaluationPromptTokens: evaluation.promptTokens,
            evaluationCompletionTokens: evaluation.completionTokens,
            evaluationTotalTokens: evaluation.totalTokens,
            evaluationDurationMs: evaluation.durationMs,
            outcome: 'evaluated' as const,
          }
        : record,
    )
    window.localStorage.setItem(storageKey(), JSON.stringify(updated))
    return true
  } catch (error) {
    console.error('PromptOS could not update local AI analytics.', error)
    return false
  }
}
