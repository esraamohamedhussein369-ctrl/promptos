import { Link } from 'react-router-dom'

export function TermsPage() {
  return (
    <main className="auth-page">
      <article className="legal-card">
        <Link className="legal-back" to="/login">← Back to PromptOS</Link>
        <p className="eyebrow">PROMPTOS</p>
        <h1>Terms of Use</h1>
        <p className="legal-updated">Effective October 27, 2026</p>
        <h2>Using PromptOS</h2>
        <p>PromptOS is a workbench for creating, reviewing, and optionally executing AI prompts. Keep your account credentials private and provide accurate account information.</p>
        <h2>AI features</h2>
        <p>When you execute or evaluate a prompt, the relevant prompt and response content is sent to the AI provider configured for this service. AI output can be inaccurate or incomplete; review it before relying on it. Do not submit passwords, API keys, or other sensitive information.</p>
        <h2>Acceptable use</h2>
        <p>Do not use the service to violate laws, infringe others’ rights, disrupt the service, or attempt to access another person’s account or data. We may limit or suspend access to protect users and the service.</p>
        <h2>Availability and changes</h2>
        <p>The service is provided as available and may change or become unavailable. You are responsible for keeping copies of important work; prompt workspaces are stored in your browser and may not sync between devices.</p>
        <h2>Related policy</h2>
        <p>Read the <Link to="/privacy">Privacy Policy</Link> for information about account, prompt, and service data.</p>
      </article>
    </main>
  )
}
