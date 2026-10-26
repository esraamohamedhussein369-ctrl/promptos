import { createServer } from 'node:http'

const server = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404)
    response.end()
    return
  }

  let body = ''
  request.on('data', (chunk) => {
    body += chunk
  })
  request.on('end', () => {
    let messages
    try {
      messages = JSON.parse(body).messages
    } catch {
      response.writeHead(400)
      response.end()
      return
    }

    const isEvaluation = messages?.[0]?.content?.includes('rigorous but fair')
    const content = isEvaluation
      ? JSON.stringify({
          score: 91,
          summary: 'The response follows the supplied instructions and includes a clear implementation plan.',
          strengths: ['Addresses the requested objective.', 'Includes verification steps.'],
          improvements: ['Add more detail about error states.'],
          criteria: [
            {
              criterion: 'Follow the prompt instructions',
              status: 'met',
              reason: 'The response addresses the stated objective and constraints.',
            },
          ],
        })
      : 'Mock AI response: implement the requested feature, preserve existing styles, and add regression tests.'

    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        model: 'promptos-local-mock',
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 24, completion_tokens: 36, total_tokens: 60 },
      }),
    )
  })
})

server.listen(8765, '127.0.0.1', () => {
  console.log('PromptOS mock AI provider listening on http://127.0.0.1:8765/v1')
  console.log('Use OPENAI_API_KEY=local-mock and OPENAI_BASE_URL=http://127.0.0.1:8765/v1.')
})
