import { useMemo } from "react";
import { usePromptStore } from "../../application/store/usePromptStore";
import { analyzePrompt } from "../../domain/intelligence/analyzer";

function scoreTone(score: number) {
  if (score >= 80) return "Strong";
  if (score >= 60) return "Needs work";
  return "Weak";
}

export function PromptIntelligencePage() {
  const prompt = usePromptStore((state) => state.prompt);
  const analysis = useMemo(() => analyzePrompt(prompt), [prompt]);

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">PROMPT INTELLIGENCE</span>
          <h1>Measure the instruction before you send it.</h1>
          <p>
            PromptOS inspects the structure of your prompt using deterministic
            engineering heuristics—no AI call required.
          </p>
        </div>
        <div className="score-card">
          <span>Overall score</span>
          <strong>{analysis.score.overall}</strong>
          <small>{scoreTone(analysis.score.overall)}</small>
        </div>
      </header>

      <div className="intelligence-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SIGNALS</span>
              <h2>Prompt quality</h2>
            </div>
            <span className="muted">{analysis.findings.length} findings</span>
          </div>

          <div className="score-list">
            {Object.entries(analysis.score)
              .filter(([key]) => key !== "overall")
              .map(([key, value]) => (
                <div className="score-row" key={key}>
                  <div className="score-row-label">
                    <span>{key}</span>
                    <strong>{value}</strong>
                  </div>
                  <div className="meter">
                    <span style={{ width: `${value}%` }} />
                  </div>
                </div>
              ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">FINDINGS</span>
              <h2>What to improve</h2>
            </div>
          </div>

          <div className="finding-list">
            {analysis.findings.map((finding) => (
              <article className={`finding finding-${finding.severity}`} key={finding.id}>
                <div className="finding-topline">
                  <strong>{finding.title}</strong>
                  <span>{finding.severity}</span>
                </div>
                <p>{finding.message}</p>
                <small>→ {finding.suggestion}</small>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
