export type UUID = string;

export type DecisionStatus = "draft" | "decided";
export type TemplateId = "study-or-work" | "job-change" | "city-choice" | "major-purchase";

export type Option = {
  id: UUID;
  name: string;
  description: string;
  isStatusQuo: boolean;
};

export type Constraint = {
  id: UUID;
  label: string;
  description: string;
  evaluations: Record<UUID, "feasible" | "infeasible" | "unknown">;
};

export type Criterion = {
  id: UUID;
  name: string;
  description: string;
  weight: number;
  lowAnchor: string;
  highAnchor: string;
};

export type Score = {
  optionId: UUID;
  criterionId: UUID;
  value: number | null;
  evidence: string;
};

export type SunkCost = {
  id: UUID;
  label: string;
  category: "money" | "time" | "energy" | "other";
  amount: number | null;
  unit: string;
  incurredAt: string;
  recoverable: boolean;
  note: string;
};

export type AdvancedSettings = {
  factorsEnabled: boolean;
  valueMappingEnabled: boolean;
  scenariosEnabled: boolean;
  riskEnabled: boolean;
  discountingEnabled: boolean;
  marginalAnalysisEnabled: boolean;
};

export type Decision = {
  id: UUID;
  revision: number;
  schemaVersion: number;
  calculationVersion: string;
  templateId: TemplateId;
  templateName: string;
  title: string;
  objective: string;
  decisionDate: string;
  status: DecisionStatus;
  chosenOptionId?: UUID;
  advancedUiExpanded: boolean;
  options: Option[];
  constraints: Constraint[];
  criteria: Criterion[];
  scores: Score[];
  sunkCosts: SunkCost[];
  advanced: AdvancedSettings;
  createdAt: string;
  updatedAt: string;
};

export type Contribution = {
  criterionId: UUID;
  criterionName: string;
  weightedContribution: number;
  score: number;
};

export type EvaluationRow = {
  rank: number;
  optionId: UUID;
  utility: number;
  bestForegoneOptionId?: UUID;
  bestForegoneUtility?: number;
  netAdvantageOverNextBest?: number;
  strengths: Contribution[];
  weaknesses: Contribution[];
};

export type EvaluationResult = {
  calculationVersion: string;
  evaluatedRevision: number;
  ready: boolean;
  errors: string[];
  rows: EvaluationRow[];
  stability: "stable" | "sensitive" | "insufficient_data";
  decisiveCriteria: string[];
  activeAdvancedModules: string[];
  notices: Array<{ concept: "opportunity" | "sunk" | "constraint" | "advanced"; title: string; body: string }>;
};

export const emptyAdvanced: AdvancedSettings = {
  factorsEnabled: false,
  valueMappingEnabled: false,
  scenariosEnabled: false,
  riskEnabled: false,
  discountingEnabled: false,
  marginalAnalysisEnabled: false,
};
