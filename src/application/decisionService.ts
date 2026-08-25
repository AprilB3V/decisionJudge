import type { Decision, EvaluationResult, TemplateId } from "../domain/types";
import { CALCULATION_VERSION, evaluateDecision } from "../domain/evaluation";
import { templates } from "../domain/templates";

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export function createDecision(templateId: TemplateId): Decision {
  const template = templates.find((item) => item.id === templateId);
  if (!template) throw new Error("template-not-found");
  const timestamp = now();
  const optionIds = template.starterOptions.map(() => id());
  const criterionIds = template.criteria.map(() => id());
  return {
    id: id(), revision: 1, schemaVersion: 1, calculationVersion: CALCULATION_VERSION,
    templateId, templateName: template.name, title: template.name, objective: "", decisionDate: "",
    status: "draft", advancedUiExpanded: false,
    options: template.starterOptions.map((option, index) => ({ ...option, id: optionIds[index]!, description: option.description })),
    constraints: [],
    criteria: template.criteria.map((criterion, index) => ({ id: criterionIds[index]!, name: criterion.name, description: criterion.description, weight: criterion.weight, lowAnchor: criterion.lowAnchor, highAnchor: criterion.highAnchor })),
    scores: optionIds.flatMap((optionId) => criterionIds.map((criterionId) => ({ optionId, criterionId, value: null, evidence: "" }))),
    sunkCosts: [],
    advanced: { factorsEnabled: false, valueMappingEnabled: false, scenariosEnabled: false, riskEnabled: false, discountingEnabled: false, marginalAnalysisEnabled: false },
    createdAt: timestamp, updatedAt: timestamp,
  };
}

export function cloneDecision(decision: Decision): Decision {
  return structuredClone(decision);
}

export function evaluate(decision: Decision): EvaluationResult {
  return evaluateDecision(decision);
}

export function updateRevision(decision: Decision): Decision {
  return { ...decision, revision: decision.revision + 1, updatedAt: now() };
}

export function createSnapshot(decision: Decision, chosenOptionId: string) {
  const result = evaluateDecision(decision);
  if (!result.ready) throw new Error(result.errors.join(" "));
  const decided = updateRevision({ ...cloneDecision(decision), status: "decided", chosenOptionId });
  return {
    id: id(), decisionId: decision.id, sourceRevision: decided.revision, chosenOptionId,
    schemaVersion: decided.schemaVersion, calculationVersion: result.calculationVersion,
    decision: structuredClone(decided), result, createdAt: now(),
  };
}

export function exportPayload(decisions: Decision[], snapshots: unknown[]) {
  return JSON.stringify({ format: "decisionjudge-export", formatVersion: 1, exportedAt: now(), appVersion: "0.1.0", schemaVersion: 1, decisions, snapshots }, null, 2);
}
