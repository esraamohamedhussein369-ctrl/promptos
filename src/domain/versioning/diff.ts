import type { PromptSnapshot } from "./types";

export type DiffStatus = "same" | "added" | "removed" | "changed";

export type DiffItem = {
  field: string;
  status: DiffStatus;
  before: string;
  after: string;
};

function format(value: string | string[] | null) {
  return value === null ? "" : Array.isArray(value) ? value.filter(Boolean).join("\n") : value;
}

export function diffSnapshots(
  before: PromptSnapshot,
  after: PromptSnapshot,
): DiffItem[] {
  const fields = [
    ["name", before.prompt.name, after.prompt.name],
    ["role", before.prompt.roleId, after.prompt.roleId],
    ["objective", before.prompt.objective, after.prompt.objective],
    ["context", before.prompt.context, after.prompt.context],
    ["constraints", before.prompt.constraints, after.prompt.constraints],
    ["requirements", before.prompt.requirements, after.prompt.requirements],
    ["outputFormat", before.prompt.outputFormat, after.prompt.outputFormat],
  ] as const;

  return fields.map(([field, beforeValue, afterValue]) => {
    const beforeText = format(beforeValue);
    const afterText = format(afterValue);

    return {
      field,
      status:
        beforeText === afterText
          ? "same"
          : beforeText
            ? afterText
              ? "changed"
              : "removed"
            : "added",
      before: beforeText,
      after: afterText,
    };
  });
}
