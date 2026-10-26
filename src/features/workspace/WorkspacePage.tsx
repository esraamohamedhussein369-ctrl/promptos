import { Link } from 'react-router-dom'
import { usePromptStore } from '../../application/store/usePromptStore'
import { analyzePrompt } from '../../domain/intelligence/analyzer'

export function WorkspacePage() {
  const prompt = usePromptStore((state) => state.prompt)
  const saveVersion = usePromptStore((state) => state.saveVersion);
  const analysis = analyzePrompt(prompt)
  return (
    <section className="page">
      <header className="page-header hero-header">
        <div>
          <p className="eyebrow">AI ENGINEERING WORKBENCH</p>
          <h1>Engineer the way your AI works.</h1>
          <p className="lede">
            Turn vague requests into structured engineering instructions with explicit roles,
            context, constraints, and output contracts.
          </p>
        </div>
        <div className="inline-actions">
          <Link className="button primary" to="/builder">Create prompt <span>↗</span></Link>
          <button className="button" onClick={() => saveVersion()}>Save version</button>
        </div>
      </header>

      <div className="workspace-grid">
        <article className="feature-card featured">
          <div className="feature-icon">✦</div>
          <h2>Prompt Builder</h2>
          <p>Build a reusable system prompt instead of asking the model a one-line question.</p>
          <Link to="/builder" className="text-link">Open builder →</Link>
        </article>
        <article className="feature-card">
          <div className="feature-icon">◈</div>
          <h2>Engineering Roles</h2>
          <p>Start from roles such as Senior Frontend Engineer, Architect, Reviewer, or Debugger.</p>
          <Link to="/roles" className="text-link">Browse roles →</Link>
        </article>
        <article className="feature-card">
          <div className="feature-icon">{analysis.score.overall}</div>
          <h2>Prompt Intelligence</h2>
          <p>Review quality signals and actionable gaps before you use a prompt.</p>
          <Link to="/intelligence" className="text-link">Review prompt →</Link>
        </article>
        <article className="feature-card">
          <div className="feature-icon">▶</div>
          <h2>Run &amp; evaluate</h2>
          <p>Execute your compiled instructions with a server-side AI provider and assess the response against your prompt.</p>
          <Link to="/execute" className="text-link">Open AI execution →</Link>
        </article>
        <article className="feature-card">
          <div className="feature-icon">↗</div>
          <h2>Templates &amp; versions</h2>
          <p>Start from a proven workflow or restore an earlier prompt snapshot.</p>
          <Link to="/templates" className="text-link">Explore templates →</Link>
        </article>
        <article className="principle-card">
          <span className="card-kicker">CORE PRINCIPLE</span>
          <blockquote>“Use AI to amplify your reasoning, not replace it.”</blockquote>
        </article>
      </div>
    </section>
  )
}