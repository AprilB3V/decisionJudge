import type { Decision, EvaluationResult, Preset, TemplateId } from "../domain/types";
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

export function createDecisionFromPreset(preset: Preset): Decision {
  const decision = createDecision("blank");
  const timestamp = now();
  const optionIds = preset.options.map(() => id());
  const criterionIds = preset.criteria.map(() => id());
  return {
    ...decision,
    templateId: preset.sourceTemplateId,
    templateName: preset.name,
    title: preset.name,
    options: preset.options.map((option, index) => ({ ...option, id: optionIds[index]! })),
    criteria: preset.criteria.map((criterion, index) => ({ ...criterion, id: criterionIds[index]! })),
    scores: optionIds.flatMap((optionId) => criterionIds.map((criterionId) => ({ optionId, criterionId, value: null, evidence: "" }))),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createPreset(decision: Decision, name: string, description = ""): Preset {
  const timestamp = now();
  return {
    id: id(),
    name: name.trim(),
    description: description.trim(),
    sourceTemplateId: decision.templateId,
    sourceTemplateName: decision.templateName,
    criteria: decision.criteria.map(({ id: _id, ...criterion }) => ({ ...criterion })),
    options: decision.options.map(({ id: _id, ...option }) => ({ ...option })),
    createdAt: timestamp,
    updatedAt: timestamp,
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

export function addDecisionOption(decision: Decision, optionId: string = id()): Decision {
  return {
    ...decision,
    options: [...decision.options, { id: optionId, name: `新方案 ${decision.options.length + 1}`, description: "", isStatusQuo: false }],
    scores: [...decision.scores, ...decision.criteria.map((criterion) => ({ optionId, criterionId: criterion.id, value: null, evidence: "" }))],
  };
}

export function removeDecisionOption(decision: Decision, optionId: string): Decision {
  if (decision.options.length <= 2) return decision;
  const removedChosenOption = decision.chosenOptionId === optionId;
  return {
    ...decision,
    options: decision.options.filter((option) => option.id !== optionId),
    scores: decision.scores.filter((score) => score.optionId !== optionId),
    constraints: decision.constraints.map((constraint) => {
      const evaluations = { ...constraint.evaluations };
      delete evaluations[optionId];
      return { ...constraint, evaluations };
    }),
    chosenOptionId: removedChosenOption ? undefined : decision.chosenOptionId,
    status: removedChosenOption ? "draft" : decision.status,
  };
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

export function exportPayload(decisions: Decision[], snapshots: unknown[], presets: Preset[] = []) {
  return JSON.stringify({ format: "decisionjudge-export", formatVersion: 1, exportedAt: now(), appVersion: "0.1.0", schemaVersion: 1, decisions, snapshots, presets }, null, 2);
}
