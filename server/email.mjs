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

export function createResendEmailSender({ apiKey, from, fetchImpl = fetch }) {
  return async ({ to, subject, text }) => {
    if (!apiKey || !from) {
      const error = new Error('Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.')
      error.status = 503
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
      error.cause = cause
      throw error
    }

    if (!response.ok) {
      const error = new Error(`Email delivery failed with HTTP ${response.status}.`)
      error.status = 502
      throw error
    }
  }
}
