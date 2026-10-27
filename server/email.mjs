function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character]
  })
}

function classifyProviderError(status, body) {
  const message = typeof body?.message === 'string' ? body.message : ''
  if (status === 403 && /testing domain|verify a domain|domain is not verified/i.test(message)) {
    return 'EMAIL_SENDER_DOMAIN_UNVERIFIED'
  }
  if (status === 401 || /invalid.*api key|missing api key/i.test(message)) {
    return 'EMAIL_PROVIDER_AUTH_FAILED'
  }
  if (status === 429) return 'EMAIL_PROVIDER_RATE_LIMITED'
  return 'EMAIL_PROVIDER_REJECTED'
}

export function createResendEmailSender({ apiKey, from, fetchImpl = fetch }) {
  return async ({ to, subject, text }) => {
    if (!apiKey || !from) {
      const error = new Error('Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.')
      error.status = 503
      error.code = 'EMAIL_NOT_CONFIGURED'
      throw error
    }

    let response
    try {
      response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          text,
          html: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`,
        }),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (cause) {
      const error = new Error('Could not reach the email delivery service.')
      error.status = 502
      error.code = 'EMAIL_PROVIDER_UNREACHABLE'
      error.cause = cause
      throw error
    }

    if (!response.ok) {
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      const error = new Error(`Email delivery failed with HTTP ${response.status}.`)
      error.status = 502
      error.code = classifyProviderError(response.status, body)
      error.providerStatus = response.status
      error.providerCode =
        typeof body?.name === 'string' && /^[a-z0-9_-]{1,64}$/i.test(body.name)
          ? body.name
          : null
      const requestId = response.headers.get('x-resend-id')
      error.providerRequestId =
        requestId && /^[a-z0-9_-]{1,128}$/i.test(requestId) ? requestId : null
      throw error
    }
  }
}
