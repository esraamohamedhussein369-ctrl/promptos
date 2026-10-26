import { create } from "zustand";
import type { Prompt } from "../../domain/prompt/types";
import type { PromptSnapshot } from "../../domain/versioning/types";
import { loadWorkspace, saveWorkspace, setWorkspaceOwner } from "../persistence/localPersistence";

type PromptStore = {
  prompt: Prompt;
  versions: PromptSnapshot[];
  setPrompt: (patch: Partial<Prompt>) => void;
  addConstraint: (constraint: string) => void;
  removeConstraint: (index: number) => void;
  addRequirement: (requirement: string) => void;
  removeRequirement: (index: number) => void;
  saveVersion: (label?: string) => void;
  restoreVersion: (versionId: string) => void;
  deleteVersion: (versionId: string) => void;
  reset: () => void;
};

function createInitialPrompt(): Prompt {
  const now = new Date().toISOString();
  return {
    id: "promptos-main",
    name: "Untitled Prompt",
    roleId: "senior-frontend",
    objective: "",
    context: "",
    constraints: [],
    requirements: [],
    outputFormat: "",
    createdAt: now,
    updatedAt: now,
  };
}

const persisted = typeof window !== "undefined" ? loadWorkspace() : null;
const initialPrompt = createInitialPrompt();

export function activatePromptOwner(ownerId: string | null) {
  setWorkspaceOwner(ownerId);
  const workspace = typeof window !== "undefined" ? loadWorkspace() : null;
  usePromptStore.setState({
    prompt: workspace?.prompt ?? createInitialPrompt(),
    versions: workspace?.versions ?? [],
  });
}

function snapshotFromPrompt(prompt: Prompt, label: string): PromptSnapshot {
  return {
    id: crypto.randomUUID(),
    label,
    promptId: prompt.id,
    createdAt: Date.now(),
    prompt: {
      name: prompt.name,
      roleId: prompt.roleId,
      objective: prompt.objective,
      context: prompt.context,
      constraints: [...prompt.constraints],
      requirements: [...prompt.requirements],
      outputFormat: prompt.outputFormat,
    },
  };
}

export const usePromptStore = create<PromptStore>((set) => ({
  prompt: persisted?.prompt ?? initialPrompt,
  versions: persisted?.versions ?? [],
  setPrompt: (patch) =>
    set((state) => {
      const prompt = { ...state.prompt, ...patch, updatedAt: new Date().toISOString() };
      saveWorkspace({ prompt, versions: state.versions });
      return { prompt };
    }),
  addConstraint: (constraint) =>
    set((state) => {
      const value = constraint.trim();
      if (!value) return state;
      const prompt = { ...state.prompt, constraints: [...state.prompt.constraints, value], updatedAt: new Date().toISOString() };
      saveWorkspace({ prompt, versions: state.versions });
      return { prompt };
    }),
  removeConstraint: (index) =>
    set((state) => {
      const prompt = { ...state.prompt, constraints: state.prompt.constraints.filter((_, itemIndex) => itemIndex !== index), updatedAt: new Date().toISOString() };
      saveWorkspace({ prompt, versions: state.versions });
      return { prompt };
    }),
  addRequirement: (requirement) =>
    set((state) => {
      const value = requirement.trim();
      if (!value) return state;
      const prompt = { ...state.prompt, requirements: [...state.prompt.requirements, value], updatedAt: new Date().toISOString() };
      saveWorkspace({ prompt, versions: state.versions });
      return { prompt };
    }),
  removeRequirement: (index) =>
    set((state) => {
      const prompt = { ...state.prompt, requirements: state.prompt.requirements.filter((_, itemIndex) => itemIndex !== index), updatedAt: new Date().toISOString() };
      saveWorkspace({ prompt, versions: state.versions });
      return { prompt };
    }),
  saveVersion: (label) =>
    set((state) => {
      const versions = [
        snapshotFromPrompt(state.prompt, label?.trim() || `Version ${state.versions.length + 1}`),
        ...state.versions,
      ].slice(0, 20);
      saveWorkspace({ prompt: state.prompt, versions });
      return { versions };
    }),
  restoreVersion: (versionId) =>
    set((state) => {
      const version = state.versions.find((item) => item.id === versionId);
      if (!version) return state;
      const prompt = { ...state.prompt, ...version.prompt, updatedAt: new Date().toISOString() };
      saveWorkspace({ prompt, versions: state.versions });
      return { prompt };
    }),
  deleteVersion: (versionId) =>
    set((state) => {
      const versions = state.versions.filter((item) => item.id !== versionId);
      saveWorkspace({ prompt: state.prompt, versions });
      return { versions };
    }),
  reset: () => {
    const prompt = createInitialPrompt();
    saveWorkspace({ prompt, versions: [] });
    set({ prompt, versions: [] });
  },
}));
