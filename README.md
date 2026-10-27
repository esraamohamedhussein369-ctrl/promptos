# PromptOS

PromptOS is a local-first workbench for creating structured engineering prompts, running them through an AI model, and reviewing the model's response.

## Run locally

Requires Node.js 20.19+.

```bash
npm install
Copy-Item .env.example .env
# Add your provider key to .env, then:
npm run dev
```

Open the local URL printed by the server. The browser app and `/api` backend share the same origin.

## Configure the AI provider

The backend supports OpenAI Chat Completions and other providers that implement the same API shape.

- `OPENAI_API_KEY`: provider secret; only the Node server reads it.
- `OPENAI_BASE_URL`: API base URL, default `https://api.openai.com/v1`.
- `OPENAI_MODEL`: model name, default `gpt-4o-mini`.
- `OPENAI_MAX_TOKENS`: maximum response tokens, default `2000`.
- `AI_TIMEOUT_MS`: provider timeout, default `60000`.
- `SESSION_SECRET`: random secret, at least 32 bytes, used to protect session tokens, hash client IPs, and derive stored rate-limit keys.
- `ADMIN_EMAIL`: email address assigned the administrator role at registration. In production this is required; all accounts must verify their email before signing in.
- `AI_DAILY_LIMIT`: maximum AI runs and evaluations combined per account per UTC day, default `20`.
- `RESEND_API_KEY` and `EMAIL_FROM`: Resend API credential and sender address on a domain verified with Resend.
- `APP_URL`: canonical public HTTPS URL used for verification and password-reset links. Required on Vercel so links never point at an individual preview deployment; Render can use `RENDER_EXTERNAL_URL` when it is unset.
- `DATABASE_PATH`: SQLite file path; defaults to `.data/promptos.sqlite`.
- `DATABASE_URL`: PostgreSQL connection string. Required in production; when set, the server uses PostgreSQL instead of SQLite.
- `TRUST_PROXY`: set to `true` only when all inbound traffic reaches the service through a trusted reverse proxy that sets `X-Forwarded-For`.
- `PORT`: server port, default `3000`.

The browser cannot set or read the API key. Do not use a `VITE_` prefix for secrets, and never commit `.env`. `/api/health` only reports whether a key is configured and the selected model.

To test the whole AI flow without a provider account or billable API request, open two terminals. In the first:

```bash
npm run mock:provider
```

In a second PowerShell terminal:

```powershell
$env:OPENAI_API_KEY = "local-mock"
$env:OPENAI_BASE_URL = "http://127.0.0.1:8765/v1"
$env:OPENAI_MODEL = "promptos-local-mock"
npm run dev
```

The mock server is bound to localhost and returns clearly labeled sample responses. Replace these test settings with your real provider settings when you are ready; real usage may incur provider charges.

## Features

- Compose and compile prompts from engineering roles, objectives, context, constraints, requirements, and output contracts.
- Execute the compiled prompt through the server-side AI provider.
- Request an AI-generated evaluation of the response against the original instructions.
- View run counts, evaluation counts, latency, and provider token usage. Only these metadata are stored locally; prompt and response text are not saved as analytics.
- Review deterministic prompt-quality signals without an AI call.
- Start from reusable templates and use Think First to structure context.
- Save, compare, restore, and delete up to 20 prompt snapshots in browser `localStorage`.

Evaluation is a model-generated estimate, not a fact-check or guarantee of correctness. Verify important answers independently.

## Commands

```bash
npm run dev
npm run build
npm start
npm test
npm run lint
```

`npm start` serves the production build from `dist` only when `NODE_ENV=production`; run `npm run build` first. Without that setting it starts the Vite development server.

In PowerShell, set the production mode for the current terminal before starting:

```powershell
$env:NODE_ENV = "production"
npm start
```

## Hosting and security

PromptOS requires a Node.js server for accounts, AI execution, email, and quotas. A static-only host such as GitHub Pages cannot run the API or keep secrets. Local development defaults to SQLite at `.data/promptos.sqlite`; production requires PostgreSQL so account and quota data survive service restarts. The included Render blueprint uses its Free web-service plan and connects to a separately provisioned Neon PostgreSQL database. Free services can sleep while idle, so expect cold starts; Neon Free has usage limits and its database may scale to zero.

### Vercel deployment

The repository also includes a Vercel Node.js function adapter in `api/[...route].mjs` and SPA routing in `vercel.json`. API paths are routed to the serverless function before static assets and the SPA fallback. Import the GitHub repository into Vercel with the project root set to `./`; Vercel uses `npm run build` and publishes `dist`. Add the production secrets in Vercel's Environment Variables settings:

```text
DATABASE_URL=<pooled Neon PostgreSQL connection string>
SESSION_SECRET=<random value at least 32 bytes>
ADMIN_EMAIL=<administrator email>
OPENAI_API_KEY=<provider key>
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=<active Groq production model>
RESEND_API_KEY=<Resend API key>
EMAIL_FROM=<sender on a verified domain>
APP_URL=https://your-production-domain.example
```

Set `APP_URL` to the canonical production HTTPS site URL in Vercel's Production environment. Production intentionally fails closed if it is missing, rather than generating links to a one-off deployment URL. Preview deployments may use their own HTTPS `VERCEL_URL` when `APP_URL` is absent. AI and email settings may be added after the initial deployment, but the related features remain unavailable until configured. Resend's `onboarding@resend.dev` sender is only suitable for limited testing to the account owner's address; public signup and password recovery require a verified sending domain. Vercel Hobby, Neon Free, Groq free-tier limits, and Resend quotas or restrictions may change; review each provider's current terms before inviting users or using the app commercially.

Before production, set the variables below using the host's secret/environment configuration, build the app, and serve it behind HTTPS:

```text
NODE_ENV=production
DATABASE_URL=<PostgreSQL connection string from Neon>
SESSION_SECRET=<random value at least 32 bytes>
ADMIN_EMAIL=<administrator email>
AI_DAILY_LIMIT=20
OPENAI_API_KEY=<provider key>
RESEND_API_KEY=<Resend API key>
EMAIL_FROM=<sender on your verified Resend domain>
```

Generate a high-entropy `SESSION_SECRET` with Node; Render generates it automatically:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Account registration is open. Registration collects only email and password; users must accept the Terms of Use and Privacy Policy, with the policy version and acceptance time recorded. Every new account must verify its email before signing in; only the address configured in `ADMIN_EMAIL` receives administrator access. Verify your sending domain in Resend before setting `EMAIL_FROM`; Vercel must have a canonical HTTPS `APP_URL`. Registration sends a one-time email verification link (24-hour expiry), login requires a verified email, and password reset links expire after one hour and revoke the account's existing sessions. Duplicate registration and reset requests use generic responses to avoid disclosing whether an email is registered. Verification and password-reset emails are limited to three sends per address per hour.

The Render blueprint in `render.yaml` configures a Free web service, HTTPS cookies, and trusted proxy address handling. Neon PostgreSQL stores accounts, sessions, quotas, email tokens, security events, and IP rate limits durably. Database-backed IP limits are atomic across processes that share the database. Only trust proxy headers when direct access to the app is blocked by the trusted ingress. The admin dashboard records metadata, never prompt or response contents; event and usage records are retained for 90 days. Prompt workspaces and local analytics remain in each user's browser and are not synced between devices. Accounts created before email verification was introduced will need to use the verification-resend action once to activate their existing address.

For Render deployment:

1. Create a Neon project on its Free plan and copy its pooled PostgreSQL connection string. Keep the connection string private.
2. Create a Render Blueprint from the GitHub repository; Render reads `render.yaml`. Select the Free web-service plan.
3. Set `DATABASE_URL` to the Neon connection string, and enter `ADMIN_EMAIL`, `OPENAI_API_KEY`, `RESEND_API_KEY`, and `EMAIL_FROM` in Render's protected environment settings. Do not put credentials in Git.
4. Verify the `EMAIL_FROM` domain with Resend; production startup fails closed if the database, AI/email credentials, security settings, or HTTPS public URL are missing. Render's generated public HTTPS URL is used for email links unless `APP_URL` is explicitly configured.
5. Keep `SESSION_SECRET` and provider credentials private, and periodically back up important account data.
6. Free hosting does not make AI usage or a verified email-sending domain free by itself. Check the current quotas and pricing of Neon, Render, your AI provider, and Resend before inviting users.

GitHub Pages alone is not suitable. A public SaaS launch may additionally require centralized alerting, abuse response, backups/restore drills, billing controls, privacy terms, and a managed database/rate-limit service before horizontal scaling.

## Architecture

Presentation → Application → Domain → Infrastructure

React pages use an application AI client; the Node server owns provider communication and secrets. Prompt compilation, role definitions, analysis, and version diffs remain separate domain logic.
