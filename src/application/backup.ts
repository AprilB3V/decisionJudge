import { z } from "zod";
import type { Decision, Preset } from "../domain/types";
import { validateWorkflow } from "../domain/workflow";
import type { SnapshotRecord } from "../infrastructure/localRepository";

export type BackupPayload = { decisions: Decision[]; snapshots: SnapshotRecord[]; presets: Preset[] };

const id = z.string().refine((value) => value.trim().length > 0, "ID 不能为空");
const finiteNonnegative = z.number().finite().nonnegative();
const nullableAmount = finiteNonnegative.nullable();
const version = z.union([z.literal(1), z.literal(2)]);
const templateId = z.enum(["blank", "study-or-work", "job-change", "city-choice", "major-purchase"]);
const optionFields = { name: z.string(), description: z.string(), isStatusQuo: z.boolean() };
const criterionFields = {
  name: z.string(), description: z.string(), weight: finiteNonnegative,
  lowAnchor: z.string(), highAnchor: z.string(),
};
const optionSchema = z.object({ id, ...optionFields }).passthrough();
const criterionSchema = z.object({ id, ...criterionFields }).passthrough();
const reviewSchema = z.object({
  id, date: z.string(), judgment: z.string(), execution: z.string(),
  externalChange: z.string(), nextStep: z.string(), createdAt: z.string().optional(),
}).passthrough();
const workflowSchema = z.object({
  verificationTasks: z.array(z.object({
    id, optionId: id.optional(), criterionId: id.optional(), hypothesis: z.string(),
    decisionImpact: z.string(), method: z.string(), source: z.string(), costAmount: nullableAmount,
    costUnit: z.enum(["CNY", "hour", "other"]), dueDate: z.string(),
    status: z.enum(["open", "in_progress", "verified", "discarded"]), finding: z.string(), updatedAt: z.string(),
  }).passthrough()),
  investments: z.array(z.object({
    id, label: z.string(), kind: z.enum(["planned", "actual", "recoverable", "boundary"]),
    amount: nullableAmount, currency: z.enum(["CNY", "other"]), hours: nullableAmount,
    note: z.string(), recordedAt: z.string(),
  }).passthrough()),
  investmentBoundary: z.object({ amount: nullableAmount, hours: nullableAmount }).passthrough().optional(),
  actionPlan: z.object({
    trigger: z.string(), action: z.string(), when: z.string(), where: z.string(),
    obstacle: z.string(), fallback: z.string(), reviewDate: z.string(),
  }).passthrough().optional(),
  predictions: z.array(z.object({
    id, statement: z.string(), probability: z.number().finite().min(0).max(1).nullable(),
    outcome: z.boolean().nullable(), dueDate: z.string(), evidence: z.string(),
    basis: z.string().optional(), outcomeEvidence: z.string().optional(), createdAt: z.string(),
    sealedAt: z.string().optional(), scoredAt: z.string().optional(),
  }).passthrough()),
  reviews: z.array(reviewSchema),
  reviewDraft: reviewSchema.optional(),
}).passthrough();

function uniqueIds(records: Array<{ id: string }>, label: string, context: z.RefinementCtx) {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) context.addIssue({ code: "custom", message: `${label}存在重复 ID：${record.id}` });
    seen.add(record.id);
  }
}

const decisionSchema = z.object({
  id, revision: z.number().int().nonnegative(), schemaVersion: version, calculationVersion: z.string(),
  templateId, templateName: z.string(), title: z.string(), objective: z.string(), decisionDate: z.string(),
  status: z.enum(["draft", "decided"]), chosenOptionId: id.optional(), advancedUiExpanded: z.boolean(),
  options: z.array(optionSchema), criteria: z.array(criterionSchema),
  constraints: z.array(z.object({
    id, label: z.string(), description: z.string(),
    evaluations: z.record(id, z.enum(["feasible", "infeasible", "unknown"])),
  }).passthrough()),
  scores: z.array(z.object({
    optionId: id, criterionId: id, value: z.number().finite().min(1).max(10).nullable(), evidence: z.string(),
    evidenceSource: z.string().optional(), evidenceDate: z.string().optional(),
    evidenceKind: z.enum(["fact", "assumption", "estimate"]).optional(),
    evidenceConfidence: z.enum(["low", "medium", "high"]).optional(),
  }).passthrough()),
  sunkCosts: z.array(z.object({
    id, label: z.string(), category: z.enum(["money", "time", "energy", "other"]),
    amount: nullableAmount, unit: z.string(), incurredAt: z.string(), recoverable: z.boolean(), note: z.string(),
  }).passthrough()),
  advanced: z.object({
    factorsEnabled: z.boolean(), valueMappingEnabled: z.boolean(), scenariosEnabled: z.boolean(),
    riskEnabled: z.boolean(), discountingEnabled: z.boolean(), marginalAnalysisEnabled: z.boolean(),
  }).passthrough(),
  workflow: workflowSchema.optional(), createdAt: z.string(), updatedAt: z.string(),
}).passthrough().superRefine((decision, context) => {
  uniqueIds([...decision.options, ...decision.criteria, ...decision.constraints, ...decision.sunkCosts], "决策内部记录", context);
  const options = new Set(decision.options.map((option) => option.id));
  const criteria = new Set(decision.criteria.map((criterion) => criterion.id));
  const scoreKeys = new Set<string>();
  for (const score of decision.scores) {
    const key = JSON.stringify([score.optionId, score.criterionId]);
    if (scoreKeys.has(key)) context.addIssue({ code: "custom", message: "同一方案和维度存在重复评分" });
    scoreKeys.add(key);
    if (!options.has(score.optionId) || !criteria.has(score.criterionId)) {
      context.addIssue({ code: "custom", message: "评分关联了不存在的方案或维度" });
    }
  }
  if (decision.chosenOptionId && !options.has(decision.chosenOptionId)) {
    context.addIssue({ code: "custom", message: "最终选择关联了不存在的方案" });
  }
  for (const constraint of decision.constraints) {
    if (Object.keys(constraint.evaluations).some((optionId) => !options.has(optionId))) {
      context.addIssue({ code: "custom", message: "约束判断关联了不存在的方案" });
    }
  }
  if (decision.workflow) {
    const workflow = decision.workflow;
    uniqueIds([
      ...workflow.verificationTasks, ...workflow.investments, ...workflow.predictions, ...workflow.reviews,
      ...(workflow.reviewDraft ? [workflow.reviewDraft] : []),
    ], "工作区记录", context);
    for (const task of workflow.verificationTasks) {
      if ((task.optionId !== undefined && !options.has(task.optionId)) || (task.criterionId !== undefined && !criteria.has(task.criterionId))) {
        context.addIssue({ code: "custom", message: "验证任务关联了不存在的方案或维度" });
      }
    }
    // Validate against the record's own timestamp, preserving deterministic historical imports.
    const validation = validateWorkflow(workflow, decision.updatedAt);
    for (const message of validation.errors) context.addIssue({ code: "custom", message });
  }
});

const presetSchema = z.object({
  id, name: z.string(), description: z.string(), sourceTemplateId: templateId, sourceTemplateName: z.string(),
  criteria: z.array(z.object(criterionFields).passthrough()),
  options: z.array(z.object(optionFields).passthrough()), createdAt: z.string(), updatedAt: z.string(),
}).passthrough();

const snapshotSchema = z.object({
  id, decisionId: id, sourceRevision: z.number().int().nonnegative(), chosenOptionId: id,
  schemaVersion: version, calculationVersion: z.string(), decision: decisionSchema,
  result: z.unknown(), createdAt: z.string(),
}).passthrough().superRefine((snapshot, context) => {
  if (!Object.hasOwn(snapshot, "result")) context.addIssue({ code: "custom", message: "快照缺少封存结果" });
  if (snapshot.decision.id !== snapshot.decisionId) context.addIssue({ code: "custom", message: "快照来源与封存决策 ID 不一致" });
  if (!snapshot.decision.options.some((option) => option.id === snapshot.chosenOptionId)) {
    context.addIssue({ code: "custom", message: "快照选择关联了不存在的方案" });
  }
  if (snapshot.decision.chosenOptionId !== snapshot.chosenOptionId) {
    context.addIssue({ code: "custom", message: "快照选择与封存决策不一致" });
  }
});

const payloadFields = {
  decisions: z.array(decisionSchema), snapshots: z.array(snapshotSchema), presets: z.array(presetSchema).default([]),
};
const payloadSchema = z.object(payloadFields).superRefine((payload, context) => {
  uniqueIds([...payload.decisions, ...payload.snapshots, ...payload.presets], "备份顶层记录", context);
  const recordIds = new Set([...payload.snapshots, ...payload.presets].map((record) => record.id));
  if (payload.snapshots.some((snapshot) => recordIds.has(snapshot.decisionId))) {
    context.addIssue({ code: "custom", message: "快照来源 ID 与快照或预设 ID 冲突" });
  }
});
const envelopeSchema = z.object({
  format: z.literal("decisionjudge-export"), formatVersion: z.literal(1), schemaVersion: version,
  ...payloadFields,
}).passthrough();

/** Validates a portable backup without recalculating or migrating its historical contents. */
export function parseBackup(text: string): BackupPayload {
  let source: unknown;
  try { source = JSON.parse(text); } catch { throw new Error("备份不是有效的 JSON 文件。"); }
  try {
    const envelope = envelopeSchema.parse(source);
    return payloadSchema.parse(envelope);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`备份内容无效：${error.issues.map((issue) => `${issue.path.join(".") || "文件"}：${issue.message}`).join("；")}`);
    }
    throw error;
  }
}

/** Creates additive import records; never mutates inputs or writes to storage. */
export function prepareBackupImport(payload: BackupPayload, existing: BackupPayload): BackupPayload {
  const incoming = structuredClone(payloadSchema.parse(payload));
  const existingIds = new Set([
    ...existing.decisions.map((record) => record.id),
    ...existing.snapshots.flatMap((record) => [record.id, record.decisionId]),
    ...existing.presets.map((record) => record.id),
  ]);
  const reserved = new Set([
    ...existingIds,
    ...incoming.decisions.map((record) => record.id),
    ...incoming.snapshots.flatMap((record) => [record.id, record.decisionId]),
    ...incoming.presets.map((record) => record.id),
  ]);
  const freshId = () => {
    let candidate: string;
    do { candidate = crypto.randomUUID(); } while (reserved.has(candidate));
    reserved.add(candidate);
    return candidate;
  };
  const logicalIds = new Set([
    ...incoming.decisions.map((record) => record.id),
    ...incoming.snapshots.map((record) => record.decisionId),
  ]);
  const decisionIds = new Map([...logicalIds].map((original) => [original, existingIds.has(original) ? freshId() : original]));
  for (const decision of incoming.decisions) decision.id = decisionIds.get(decision.id)!;
  for (const snapshot of incoming.snapshots) {
    snapshot.decisionId = decisionIds.get(snapshot.decisionId)!;
    snapshot.decision.id = snapshot.decisionId;
    if (existingIds.has(snapshot.id)) snapshot.id = freshId();
  }
  for (const preset of incoming.presets) if (existingIds.has(preset.id)) preset.id = freshId();
  return incoming;
}
