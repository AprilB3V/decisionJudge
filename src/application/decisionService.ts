import type { Decision, EvaluationResult, Preset, TemplateId } from "../domain/types";
import { CALCULATION_VERSION, evaluateDecision } from "../domain/evaluation";
import { templates } from "../domain/templates";
import { emptyWorkflow, validateWorkflow, validateWorkflowTransition } from "../domain/workflow";

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
    workflow: emptyWorkflow(),
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
  return { ...decision, calculationVersion: CALCULATION_VERSION, revision: decision.revision + 1, updatedAt: now() };
}

/** Keep links valid when options/criteria are removed, without discarding their evidence. */
export function applyDecisionChange(decision: Decision, change: Partial<Decision>): Decision {
  const next = { ...decision, ...change, updatedAt: now() };
  if (next.workflow) {
    const options = new Set(next.options.map((item) => item.id));
    const criteria = new Set(next.criteria.map((item) => item.id));
    next.workflow = { ...next.workflow, verificationTasks: next.workflow.verificationTasks.map((task) => ({
      ...task,
      optionId: task.optionId && options.has(task.optionId) ? task.optionId : undefined,
      criterionId: task.criterionId && criteria.has(task.criterionId) ? task.criterionId : undefined,
    })) };
  }
  const validation = validateWorkflowTransition(decision.workflow ?? emptyWorkflow(), next.workflow ?? emptyWorkflow());
  if (!validation.valid) throw new Error(validation.errors.join("；"));
  // A new comparison is a draft; old choices remain available in immutable snapshots.
  if (["options", "criteria", "scores", "constraints", "objective", "decisionDate", "title"].some((key) => key in change)) {
    next.status = "draft";
    next.chosenOptionId = undefined;
  }
  return next;
}

export function addDecisionOption(decision: Decision, optionId: string = id()): Decision {
  return applyDecisionChange(decision, {
    options: [...decision.options, { id: optionId, name: `新方案 ${decision.options.length + 1}`, description: "", isStatusQuo: false }],
    scores: [...decision.scores, ...decision.criteria.map((criterion) => ({ optionId, criterionId: criterion.id, value: null, evidence: "" }))],
  });
}

export function removeDecisionOption(decision: Decision, optionId: string): Decision {
  if (decision.options.length <= 2) return decision;
  return applyDecisionChange(decision, {
    options: decision.options.filter((option) => option.id !== optionId),
    scores: decision.scores.filter((score) => score.optionId !== optionId),
    constraints: decision.constraints.map((constraint) => {
      const evaluations = { ...constraint.evaluations };
      delete evaluations[optionId];
      return { ...constraint, evaluations };
    }),
    workflow: decision.workflow ? { ...decision.workflow, verificationTasks: decision.workflow.verificationTasks.map((task) => task.optionId === optionId ? { ...task, optionId: undefined } : task) } : undefined,
  });
}

export function createSnapshot(decision: Decision, chosenOptionId: string) {
  if (!decision.title.trim() || decision.options.some((option) => !option.name.trim())) throw new Error("请先填写决策和方案名称。");
  if (decision.workflow) {
    const validation = validateWorkflow(decision.workflow);
    if (!validation.valid) throw new Error(validation.errors.join("；"));
  }
  const decided = updateRevision({ ...cloneDecision(decision), status: "decided", chosenOptionId });
  const result = evaluateDecision(decided);
  if (!result.ready) throw new Error(result.errors.join(" "));
  if (!result.rows.some((row) => row.optionId === chosenOptionId)) throw new Error("请选择当前排名中的方案。");
  if (decision.constraints.some((constraint) => !constraint.label.trim() || constraint.evaluations[chosenOptionId] !== "feasible")) throw new Error("请先确认所选方案满足每一条底线。");
  return {
    id: id(), decisionId: decision.id, sourceRevision: decided.revision, chosenOptionId,
    schemaVersion: decided.schemaVersion, calculationVersion: result.calculationVersion,
    decision: structuredClone(decided), result, createdAt: now(),
  };
}

export function exportPayload(decisions: Decision[], snapshots: unknown[], presets: Preset[] = []) {
  return JSON.stringify({ format: "decisionjudge-export", formatVersion: 1, exportedAt: now(), appVersion: "0.3.0", schemaVersion: 1, decisions, snapshots, presets }, null, 2);
}
