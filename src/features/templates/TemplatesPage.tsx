import { promptTemplates } from "../../domain/templates/templates";
import { usePromptStore } from "../../application/store/usePromptStore";

export function TemplatesPage() {
  const setPrompt = usePromptStore((state) => state.setPrompt);

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">TEMPLATES</span>
          <h1>Start from an engineered baseline.</h1>
          <p>Reusable prompt structures for common engineering workflows.</p>
        </div>
      </header>

      <div className="template-grid">
        {promptTemplates.map((template) => (
          <article className="template-card" key={template.id}>
            <div>
              <span className="eyebrow">PROMPT TEMPLATE</span>
              <h2>{template.name}</h2>
              <p>{template.description}</p>
            </div>
            <button
              className="button button-primary"
              onClick={() =>
                setPrompt({
                  name: template.name,
                  roleId: template.roleId,
                  objective: template.objective,
                  context: template.context,
                  constraints: template.constraints,
                  requirements: template.requirements,
                  outputFormat: template.outputFormat,
                })
              }
            >
              Use template
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
