import { Link } from 'react-router-dom'

export function PrivacyPage() {
  return (
    <main className="auth-page">
      <article className="legal-card">
        <Link className="legal-back" to="/login">← Back to PromptOS</Link>
        <p className="eyebrow">PROMPTOS</p>
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Effective October 27, 2026</p>
        <h2>Information we store</h2>
        <p>For an account, PromptOS stores your email address, a salted password hash, the date and version of your acceptance of the Terms of Use and this policy, and account security data. Passwords are not stored in plain text. We do not request a phone number, age, or display name.</p>
        <p>Session tokens, email verification and password-reset tokens, and rate-limit identifiers are stored in protected or hashed form. Security and AI usage records contain operational metadata such as event type, time, status, model, and token counts; they do not contain prompt or response text.</p>
        <h2>Prompts and AI providers</h2>
        <p>Prompt workspaces and local analytics are stored in your browser. If you choose to run or evaluate a prompt, the relevant content is sent to the AI provider configured by the service operator. That provider processes it under its own terms and privacy policy.</p>
        <h2>Email and hosting providers</h2>
        <p>Account verification and password-reset messages are handled by the configured email provider. The service uses hosting and database providers to operate the application and store account data. Those providers process information as needed to provide their services.</p>
        <h2>Security and retention</h2>
        <p>PromptOS uses password hashing, secure session cookies, one-time email tokens, and request limits to protect accounts. Security and AI usage metadata are retained for up to 90 days; account records are retained while the account is active.</p>
        <h2>Related terms</h2>
        <p>Use of the service is also governed by the <Link to="/terms">Terms of Use</Link>.</p>
      </article>
    </main>
  )
}
