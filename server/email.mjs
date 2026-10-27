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
  if ([400, 403].includes(status) &&
      /testing domain|verify a domain|domain is not verified|sender.*(verif|valid|active)/i.test(message)) {
    return 'EMAIL_SENDER_DOMAIN_UNVERIFIED'
  }
  if (status === 401 || /invalid.*api key|missing api key/i.test(message)) {
    return 'EMAIL_PROVIDER_AUTH_FAILED'
  }
  if (status === 429) return 'EMAIL_PROVIDER_RATE_LIMITED'
  return 'EMAIL_PROVIDER_REJECTED'
}

function emailFailure(status, body, requestId) {
  const error = new Error(`Email delivery failed with HTTP ${status}.`)
  error.status = 502
  error.code = classifyProviderError(status, body)
  error.providerStatus = status
  const providerCode = typeof body?.name === 'string' ? body.name : body?.code
  error.providerCode =
    typeof providerCode === 'string' && /^[a-z0-9_-]{1,64}$/i.test(providerCode)
      ? providerCode
      : null
  error.providerRequestId =
    requestId && /^[a-z0-9_-]{1,128}$/i.test(requestId) ? requestId : null
  return error
}

function providerErrorBody(response) {
  return response.json().catch(() => null)
}

function fromAddress(from) {
  const match = from.match(/<([^<>]+)>/)
  return (match?.[1] ?? from).trim()
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
      throw emailFailure(
        response.status,
        await providerErrorBody(response),
        response.headers.get('x-resend-id'),
      )
    }
  }
}

export function createBrevoEmailSender({ apiKey, from, fetchImpl = fetch }) {
  return async ({ to, subject, text }) => {
    if (!apiKey || !from) {
      const error = new Error('Email delivery is not configured. Set BREVO_API_KEY and EMAIL_FROM.')
      error.status = 503
      error.code = 'EMAIL_NOT_CONFIGURED'
      throw error
    }

    let response
    try {
      response = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'PromptOS', email: fromAddress(from) },
          to: [{ email: to }],
          subject,
          textContent: text,
          htmlContent: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`,
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
      throw emailFailure(
        response.status,
        await providerErrorBody(response),
        response.headers.get('x-sib-request-id') || response.headers.get('x-request-id'),
      )
    }
  }
}
