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
- `SIGNUP_INVITE_CODE`: private invitation value, at least 12 bytes, required to create accounts.
- `ADMIN_SETUP_CODE`: separate private value, at least 12 bytes, additionally required when creating the configured administrator account.
- `ADMIN_EMAIL`: email address assigned the administrator role at registration. In production this is required.
- `AI_DAILY_LIMIT`: maximum AI runs and evaluations combined per account per UTC day, default `20`.
- `RESEND_API_KEY` and `EMAIL_FROM`: Resend API credential and sender address on a domain verified with Resend.
- `APP_URL`: public HTTPS URL used for verification and password-reset links. Render's `RENDER_EXTERNAL_URL` is used when this is unset.
- `DATABASE_PATH`: SQLite file path; defaults to `.data/promptos.sqlite`.
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

PromptOS now requires a Node.js server for accounts, AI execution, email, and quotas. A static-only host such as GitHub Pages cannot run the API or keep secrets. The SQLite database at `.data/promptos.sqlite` stores accounts, sessions, quotas, email tokens, security events, and persistent IP rate-limit counters. Keep it on a persistent disk and take regular protected backups. The Render blueprint provisions one web instance with a persistent disk; do not scale it to multiple instances or use shared network storage for SQLite.

Before production, set the variables below using the host's secret/environment configuration, build the app, and serve it behind HTTPS:

```text
NODE_ENV=production
SESSION_SECRET=<random value at least 32 bytes>
SIGNUP_INVITE_CODE=<private invite at least 12 bytes>
ADMIN_SETUP_CODE=<separate private admin setup code at least 12 bytes>
ADMIN_EMAIL=<administrator email>
AI_DAILY_LIMIT=20
OPENAI_API_KEY=<provider key>
RESEND_API_KEY=<Resend API key>
EMAIL_FROM=<sender on your verified Resend domain>
```

Generate high-entropy values with Node; Render generates `SESSION_SECRET` automatically, while you provide the two invitation codes through its protected setup prompts:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use separate values for `SESSION_SECRET`, `SIGNUP_INVITE_CODE`, and `ADMIN_SETUP_CODE`. Keep both invite codes private; only give the admin setup code to the configured administrator. The admin code prevents a regular invite holder from reserving the admin email before its owner registers. Rotate the signup invite to stop new registrations. Verify your sending domain in Resend before setting `EMAIL_FROM`; production startup fails closed if AI/email credentials or an HTTPS public URL are missing. Registration sends a one-time email verification link (24-hour expiry), login requires a verified email, and password reset links expire after one hour and revoke the account's existing sessions. Reset requests use a generic response to avoid disclosing whether an email is registered.

The Render blueprint in `render.yaml` sets production mode, persistent disk storage, HTTPS cookies, and trusted proxy address handling. Database-backed IP limits survive restarts and apply atomically across processes using the same database, but the deployment intentionally uses one instance; this is not a horizontally distributed rate limiter. Only trust proxy headers when direct access to the app is blocked by the trusted ingress. The admin dashboard records metadata, never prompt or response contents; event and usage records are retained for 90 days. Prompt workspaces and local analytics remain in each user's browser and are not synced between devices. Accounts created before email verification was introduced will need to use the verification-resend action once to activate their existing address.

For Render deployment:

1. Generate `SIGNUP_INVITE_CODE` and `ADMIN_SETUP_CODE` as separate random values, then push this project to a GitHub repository and create a Render Blueprint from it; Render reads `render.yaml`.
2. Enter both invite codes, `ADMIN_EMAIL`, `OPENAI_API_KEY`, `RESEND_API_KEY`, and `EMAIL_FROM` when Render prompts for unsynchronized values. Do not put credentials in Git.
3. Verify the `EMAIL_FROM` domain with Resend. The server uses Render's generated public HTTPS URL for email links unless `APP_URL` is explicitly configured.
4. Keep the generated `SESSION_SECRET` and invite private. Share the invite only with people you trust.
5. Keep the one-instance configuration and persistent disk enabled. Configure regular backups before storing important accounts.

GitHub Pages alone is not suitable. A public SaaS launch may additionally require centralized alerting, abuse response, backups/restore drills, billing controls, privacy terms, and a managed database/rate-limit service before horizontal scaling.

## Architecture

Presentation → Application → Domain → Infrastructure

React pages use an application AI client; the Node server owns provider communication and secrets. Prompt compilation, role definitions, analysis, and version diffs remain separate domain logic.
