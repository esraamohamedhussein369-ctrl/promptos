export type PromptSnapshot = {
  id: string;
  label: string;
  promptId: string;
  createdAt: number;
  prompt: {
    name: string;
    roleId: string | null;
    objective: string;
    context: string;
    constraints: string[];
    requirements: string[];
    outputFormat: string;
  };
};
