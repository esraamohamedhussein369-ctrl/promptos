export type PromptTemplate = {
  id: string;
  name: string;
  description: string;
  roleId: string;
  objective: string;
  context: string;
  constraints: string[];
  requirements: string[];
  outputFormat: string;
};

export const promptTemplates: PromptTemplate[] = [
  {
    id: "frontend-feature",
    name: "Frontend Feature",
    description: "Plan and implement a production-ready frontend feature.",
    roleId: "senior-frontend",
    objective: "Design and implement a production-ready frontend feature with clear UX, maintainable architecture, accessibility, and tests.",
    context: "The project is a React + TypeScript application. The feature should fit the existing architecture and design system without introducing unnecessary dependencies.",
    constraints: [
      "Prefer existing components and utilities before creating new abstractions.",
      "Keep the implementation responsive and accessible.",
      "Do not introduce dependencies without explaining the trade-off.",
    ],
    requirements: [
      "Describe the implementation plan first.",
      "Provide the relevant files and code changes.",
      "Include edge cases and testing strategy.",
    ],
    outputFormat: "Return: assumptions, plan, implementation, testing, edge cases, and final checklist.",
  },
  {
    id: "code-review",
    name: "Production Code Review",
    description: "Review code for correctness, maintainability, security, and performance.",
    roleId: "code-reviewer",
    objective: "Review the supplied implementation and identify concrete correctness, security, performance, accessibility, and maintainability issues.",
    context: "The code is intended for production. Prioritize issues that can cause user-facing bugs, data loss, security problems, or long-term maintenance cost.",
    constraints: [
      "Do not rewrite code unless a change is necessary to demonstrate the fix.",
      "Separate confirmed issues from suggestions.",
    ],
    requirements: [
      "Rank findings by severity.",
      "Explain why each finding matters.",
      "Provide a focused remediation for each confirmed issue.",
    ],
    outputFormat: "Return a severity-ranked review with file/line references where available and a concise remediation plan.",
  },
  {
    id: "debugging",
    name: "Debugging Session",
    description: "Turn a vague bug report into a systematic debugging plan.",
    roleId: "debugger",
    objective: "Diagnose the reported bug systematically, isolate the root cause, and propose the smallest reliable fix.",
    context: "The application is a modern web application. Evidence may include symptoms, logs, stack traces, recent changes, and reproduction steps.",
    constraints: [
      "Do not assume the root cause before evaluating the evidence.",
      "Prefer reproducible hypotheses over speculative fixes.",
    ],
    requirements: [
      "List the strongest hypotheses.",
      "Describe how to validate each hypothesis.",
      "Recommend the smallest safe fix after identifying the root cause.",
    ],
    outputFormat: "Return: evidence, hypotheses, validation steps, root cause, fix, regression tests.",
  },
];
