import { useMemo, useState } from "react";
import { usePromptStore } from "../../application/store/usePromptStore";
import { diffSnapshots } from "../../domain/versioning/diff";

export function VersionsPage() {
  const prompt = usePromptStore((state) => state.prompt);
  const versions = usePromptStore((state) => state.versions);
  const saveVersion = usePromptStore((state) => state.saveVersion);
  const restoreVersion = usePromptStore((state) => state.restoreVersion);
  const deleteVersion = usePromptStore((state) => state.deleteVersion);
  const [label, setLabel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = versions.find((item) => item.id === selectedId) ?? versions[0];
  const currentSnapshot = useMemo(
    () => ({
      id: "current",
      label: "Current",
      promptId: prompt.id,
      createdAt: Date.parse(prompt.updatedAt),
      prompt: {
        name: prompt.name,
        roleId: prompt.roleId,
        objective: prompt.objective,
        context: prompt.context,
        constraints: prompt.constraints,
        requirements: prompt.requirements,
        outputFormat: prompt.outputFormat,
      },
    }),
    [prompt],
  );

  const diff = selected ? diffSnapshots(selected, currentSnapshot) : [];

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">VERSION CONTROL</span>
          <h1>Keep every useful prompt iteration.</h1>
          <p>Save checkpoints, restore them, and inspect exactly what changed.</p>
        </div>
      </header>

      <section className="panel version-toolbar">
        <input
          className="text-input"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Version label, e.g. Added API constraints"
          aria-label="Version label"
        />
        <button
          className="button button-primary"
          onClick={() => {
            saveVersion(label);
            setLabel("");
          }}
        >
          Save snapshot
        </button>
      </section>

      <div className="version-layout">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">HISTORY</span>
              <h2>Snapshots</h2>
            </div>
            <span className="muted">{versions.length}/20</span>
          </div>

          {versions.length === 0 ? (
            <div className="empty-state">
              <strong>No snapshots yet.</strong>
              <p>Save a version from the current prompt to start building history.</p>
            </div>
          ) : (
            <div className="version-list">
              {versions.map((version) => (
                <button
                  className={`version-item ${selected?.id === version.id ? "active" : ""}`}
                  key={version.id}
                  onClick={() => setSelectedId(version.id)}
                >
                  <strong>{version.label}</strong>
                  <span>{new Date(version.createdAt).toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">DIFF</span>
              <h2>{selected ? `Compare: ${selected.label}` : "Compare versions"}</h2>
            </div>
          </div>

          {selected ? (
            <>
              <div className="diff-list">
                {diff.map((item) => (
                  <article className={`diff-row diff-${item.status}`} key={item.field}>
                    <div className="diff-field">
                      <strong>{item.field}</strong>
                      <span>{item.status}</span>
                    </div>
                    <div className="diff-values">
                      <pre>{item.before || "—"}</pre>
                      <pre>{item.after || "—"}</pre>
                    </div>
                  </article>
                ))}
              </div>
              <div className="inline-actions">
                <button className="button" onClick={() => restoreVersion(selected.id)}>
                  Restore snapshot
                </button>
                <button className="button button-danger" onClick={() => deleteVersion(selected.id)}>
                  Delete
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <strong>Nothing to compare.</strong>
              <p>Create at least one snapshot first.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
