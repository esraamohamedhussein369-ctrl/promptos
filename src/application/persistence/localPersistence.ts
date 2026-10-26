import type { Prompt } from "../../domain/prompt/types";
import type { PromptSnapshot } from "../../domain/versioning/types";

const KEY = "promptos.workspace.v1";
let activeOwnerId: string | null = null;

export function setWorkspaceOwner(ownerId: string | null) {
  activeOwnerId = ownerId;
}

function storageKey() {
  return activeOwnerId ? `${KEY}.${activeOwnerId}` : KEY;
}

export type PersistedWorkspace = {
  prompt: Prompt;
  versions: PromptSnapshot[];
};

function isPrompt(value: unknown): value is Prompt {
  if (!value || typeof value !== "object") return false;
  const prompt = value as Partial<Prompt>;
  return (
    typeof prompt.id === "string" &&
    typeof prompt.name === "string" &&
    (typeof prompt.roleId === "string" || prompt.roleId === null) &&
    typeof prompt.objective === "string" &&
    typeof prompt.context === "string" &&
    Array.isArray(prompt.constraints) &&
    prompt.constraints.every((item) => typeof item === "string") &&
    Array.isArray(prompt.requirements) &&
    prompt.requirements.every((item) => typeof item === "string") &&
    typeof prompt.outputFormat === "string" &&
    (typeof prompt.createdAt === "string" || typeof prompt.createdAt === "number") &&
    (typeof prompt.updatedAt === "string" || typeof prompt.updatedAt === "number")
  );
}

function isSnapshot(value: unknown): value is PromptSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<PromptSnapshot>;
  const prompt = snapshot.prompt;
  return (
    typeof snapshot.id === "string" &&
    typeof snapshot.label === "string" &&
    typeof snapshot.promptId === "string" &&
    typeof snapshot.createdAt === "number" &&
    !!prompt &&
    typeof prompt.name === "string" &&
    (typeof prompt.roleId === "string" || prompt.roleId === null) &&
    typeof prompt.objective === "string" &&
    typeof prompt.context === "string" &&
    Array.isArray(prompt.constraints) &&
    prompt.constraints.every((item) => typeof item === "string") &&
    Array.isArray(prompt.requirements) &&
    prompt.requirements.every((item) => typeof item === "string") &&
    typeof prompt.outputFormat === "string"
  );
}

function normalizeRoleId(roleId: string | null): string | null {
  return roleId === "senior-frontend-engineer" ? "senior-frontend" : roleId;
}

export function loadWorkspace(): PersistedWorkspace | null {
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !isPrompt((value as Partial<PersistedWorkspace>).prompt) ||
      !Array.isArray((value as Partial<PersistedWorkspace>).versions) ||
      !(value as Partial<PersistedWorkspace>).versions?.every(isSnapshot)
    ) {
      console.error("PromptOS could not load saved workspace: stored data has an invalid format.");
      return null;
    }

    const workspace = value as PersistedWorkspace;
    return {
      prompt: {
        ...workspace.prompt,
        roleId: normalizeRoleId(workspace.prompt.roleId),
        createdAt: new Date(workspace.prompt.createdAt).toISOString(),
        updatedAt: new Date(workspace.prompt.updatedAt).toISOString(),
      },
      versions: workspace.versions.map((snapshot) => ({
        ...snapshot,
        prompt: {
          ...snapshot.prompt,
          roleId: normalizeRoleId(snapshot.prompt.roleId),
        },
      })),
    };
  } catch (error) {
    console.error("PromptOS could not load saved workspace.", error);
    return null;
  }
}

export function saveWorkspace(workspace: PersistedWorkspace) {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(workspace));
  } catch (error) {
    console.error("PromptOS could not save the workspace. Changes may not persist.", error);
  }
}
