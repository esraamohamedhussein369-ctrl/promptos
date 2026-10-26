import { useMemo, useState } from "react";
import { usePromptStore } from "../../application/store/usePromptStore";

const questions = [
  ["Goal", "What exact result should exist after the model finishes?"],
  ["Evidence", "What facts, code, files, or constraints should the model trust?"],
  ["Success", "How will you know the result is correct or complete?"],
  ["Boundaries", "What should the model explicitly avoid doing?"],
];

export function ThinkFirstPage() {
  const prompt = usePromptStore((state) => state.prompt);
  const setPrompt = usePromptStore((state) => state.setPrompt);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const generated = useMemo(
    () =>
      questions
        .map(([title]) => `${title}: ${answers[title] ?? ""}`)
        .filter((line) => line.split(": ")[1]?.trim())
        .join("\n"),
    [answers],
  );

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">THINK FIRST</span>
          <h1>Reason before you prompt.</h1>
          <p>Answer four engineering questions, then turn the reasoning into context.</p>
        </div>
      </header>

      <div className="think-grid">
        <section className="panel">
          <div className="question-list">
            {questions.map(([title, question]) => (
              <label className="question-card" key={title}>
                <span className="eyebrow">{title}</span>
                <strong>{question}</strong>
                <textarea
                  className="text-area"
                  value={answers[title] ?? ""}
                  onChange={(event) =>
                    setAnswers((current) => ({ ...current, [title]: event.target.value }))
                  }
                  placeholder={`Write your ${title.toLowerCase()}...`}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">CONTEXT OUTPUT</span>
              <h2>Inject into prompt</h2>
            </div>
          </div>
          <pre className="generated-context">{generated || "Your structured thinking will appear here."}</pre>
          <button
            className="button button-primary"
            disabled={!generated}
            onClick={() =>
              setPrompt({
                context: [prompt.context.trim(), generated].filter(Boolean).join("\n\n"),
              })
            }
          >
            Add to current prompt
          </button>
        </section>
      </div>
    </section>
  );
}
