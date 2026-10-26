import type { Prompt } from "../prompt/types";

export type FindingSeverity = "critical" | "warning" | "info" | "success";

export type PromptFinding = {
  id: string;
  severity: FindingSeverity;
  title: string;
  message: string;
  suggestion: string;
};

export type PromptScore = {
  role: number;
  context: number;
  constraints: number;
  output: number;
  clarity: number;
  ambiguity: number;
  overall: number;
};

export type PromptAnalysis = {
  score: PromptScore;
  findings: PromptFinding[];
};

const words = (value: string) =>
  value.trim().split(/\s+/).filter(Boolean);

const hasAny = (value: string, terms: string[]) =>
  terms.some((term) => value.toLowerCase().includes(term));

export function analyzePrompt(prompt: Prompt): PromptAnalysis {
  const findings: PromptFinding[] = [];

  const objectiveWords = words(prompt.objective);
  const contextWords = words(prompt.context);
  const requirementCount = prompt.requirements.filter(Boolean).length;
  const constraintCount = prompt.constraints.filter(Boolean).length;

  const role = prompt.roleId ? 100 : 0;
  const context = Math.min(100, contextWords.length >= 25 ? 100 : contextWords.length * 4);
  const constraints = Math.min(100, constraintCount * 25);
  const output = prompt.outputFormat.trim() ? 100 : 0;

  const claritySignals = [
    objectiveWords.length >= 8,
    objectiveWords.length <= 45,
    requirementCount >= 2,
    !hasAny(prompt.objective, ["something", "anything", "stuff", "etc"]),
  ];
  const clarity = Math.round(
    (claritySignals.filter(Boolean).length / claritySignals.length) * 100,
  );

  const vagueTerms = ["good", "better", "nice", "simple", "best", "professional", "fast"];
  const vagueCount = vagueTerms.filter((term) =>
    prompt.objective.toLowerCase().includes(term),
  ).length;
  const ambiguity = Math.max(0, 100 - vagueCount * 20 - (objectiveWords.length < 5 ? 25 : 0));

  if (!prompt.roleId) {
    findings.push({
      id: "missing-role",
      severity: "critical",
      title: "Role is missing",
      message: "The model has no explicit engineering perspective to operate from.",
      suggestion: "Choose a role such as Senior Frontend Engineer or Code Reviewer.",
    });
  } else {
    findings.push({
      id: "role-defined",
      severity: "success",
      title: "Role is defined",
      message: "The prompt establishes who the model should behave as.",
      suggestion: "Keep the role focused on the actual responsibility.",
    });
  }

  if (contextWords.length < 15) {
    findings.push({
      id: "thin-context",
      severity: "warning",
      title: "Context is thin",
      message: "There may not be enough project information to produce a reliable answer.",
      suggestion: "Add stack, current state, constraints, and relevant project details.",
    });
  }

  if (constraintCount === 0) {
    findings.push({
      id: "no-constraints",
      severity: "warning",
      title: "No constraints",
      message: "The model has a large solution space and may choose assumptions you do not want.",
      suggestion: "Add explicit technical, UX, scope, or architecture constraints.",
    });

  }

  if (requirementCount < 2) {
    findings.push({
      id: "few-requirements",
      severity: "warning",
      title: "Requirements are under-specified",
      message: "The objective alone may not define what a complete solution looks like.",
      suggestion: "Break the desired result into concrete, testable requirements.",
    });
  }

  if (!prompt.outputFormat.trim()) {
    findings.push({
      id: "missing-output",
      severity: "warning",
      title: "Output contract is missing",
      message: "The model can choose its own response structure.",
      suggestion: "Define the expected sections, format, or acceptance criteria.",
    });
  }

  if (vagueCount > 0) {
    findings.push({
      id: "vague-language",
      severity: "info",
      title: "Vague language detected",
      message: "Some words can be interpreted differently by different models.",
      suggestion: "Replace subjective words with measurable behavior or acceptance criteria.",
    });
  }

  if (objectiveWords.length < 5) {
    findings.push({
      id: "short-objective",
      severity: "critical",
      title: "Objective is too short",
      message: "The objective does not give the model enough direction.",
      suggestion: "State what should be produced, for whom, and what success looks like.",
    });
  }

  const score = {
    role,
    context,
    constraints,
    output,
    clarity,
    ambiguity,
    overall: Math.round((role + context + constraints + output + clarity + ambiguity) / 6),
  };

  return { score, findings };
}
