/** Follow-through data around a decision: evidence, action, prediction and review. */
export type VerificationStatus = "open" | "in_progress" | "verified" | "discarded";

export type VerificationTask = {
  id: string;
  optionId?: string;
  criterionId?: string;
  hypothesis: string;
  decisionImpact: string;
  method: string;
  source: string;
  costAmount: number | null;
  /** `other` is retained only to read old records; new records must use CNY or hour. */
  costUnit: "CNY" | "hour" | "other";
  dueDate: string;
  status: VerificationStatus;
  finding: string;
  updatedAt: string;
};

export type InvestmentKind = "planned" | "actual" | "recoverable" | "boundary";
export type InvestmentRecord = {
  id: string;
  label: string;
  kind: InvestmentKind;
  amount: number | null;
  /** Money is CNY only. `other` is kept for migration diagnostics. */
  currency: "CNY" | "other";
  hours: number | null;
  note: string;
  recordedAt: string;
};

/** One optional ceiling for each unit; ceiling values are not accumulated. */
export type InvestmentBoundary = { amount: number | null; hours: number | null };

export type ActionPlan = {
  trigger: string;
  action: string;
  when: string;
  where: string;
  obstacle: string;
  fallback: string;
  reviewDate: string;
};

export type Prediction = {
  id: string;
  statement: string;
  probability: number | null;
  outcome: boolean | null;
  dueDate: string;
  /** Legacy combined field; new records use basis and outcomeEvidence. */
  evidence: string;
  basis?: string;
  outcomeEvidence?: string;
  createdAt: string;
  /** Once set, statement/probability/dueDate/basis are immutable. */
  sealedAt?: string;
  scoredAt?: string;
};

export type DecisionReview = {
  id: string;
  date: string;
  judgment: string;
  execution: string;
  externalChange: string;
  nextStep: string;
  createdAt?: string;
};

export type DecisionWorkflow = {
  verificationTasks: VerificationTask[];
  investments: InvestmentRecord[];
  /** Preferred boundary representation; boundary rows remain readable during migration. */
  investmentBoundary?: InvestmentBoundary;
  actionPlan?: ActionPlan;
  predictions: Prediction[];
  reviews: DecisionReview[];
  reviewDraft?: DecisionReview;
};

export const emptyWorkflow = (): DecisionWorkflow => ({ verificationTasks: [], investments: [], predictions: [], reviews: [] });

export type InvestmentTotals = {
  plannedAmount: number; actualAmount: number; recoverableAmount: number; boundaryAmount: number;
  plannedHours: number; actualHours: number; recoverableHours: number; boundaryHours: number;
  boundaryAmountConfigured: boolean; boundaryHoursConfigured: boolean;
};

const nonNegative = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;

/** Totals money and time independently; a legacy boundary row uses its latest value. */
export function investmentTotals(investments: InvestmentRecord[], boundary?: InvestmentBoundary): InvestmentTotals {
  const totals: InvestmentTotals = {
    plannedAmount: 0, actualAmount: 0, recoverableAmount: 0, boundaryAmount: 0,
    plannedHours: 0, actualHours: 0, recoverableHours: 0, boundaryHours: 0,
    boundaryAmountConfigured: boundary?.amount !== null && boundary?.amount !== undefined,
    boundaryHoursConfigured: boundary?.hours !== null && boundary?.hours !== undefined,
  };
  let legacyAmount: number | undefined;
  let legacyHours: number | undefined;
  for (const item of investments) {
    if (item.kind === "boundary") {
      if (item.amount !== null && item.currency === "CNY" && nonNegative(item.amount)) legacyAmount = item.amount;
      if (item.hours !== null && nonNegative(item.hours)) legacyHours = item.hours;
      continue;
    }
    if (item.amount !== null && item.currency === "CNY" && nonNegative(item.amount)) {
      if (item.kind === "planned") totals.plannedAmount += item.amount;
      if (item.kind === "actual") totals.actualAmount += item.amount;
      if (item.kind === "recoverable") totals.recoverableAmount += item.amount;
    }
    if (item.hours !== null && nonNegative(item.hours)) {
      if (item.kind === "planned") totals.plannedHours += item.hours;
      if (item.kind === "actual") totals.actualHours += item.hours;
      if (item.kind === "recoverable") totals.recoverableHours += item.hours;
    }
  }
  if (!boundary && legacyAmount !== undefined) { totals.boundaryAmount = legacyAmount; totals.boundaryAmountConfigured = true; }
  else if (totals.boundaryAmountConfigured) totals.boundaryAmount = boundary!.amount!;
  if (!boundary && legacyHours !== undefined) { totals.boundaryHours = legacyHours; totals.boundaryHoursConfigured = true; }
  else if (totals.boundaryHoursConfigured) totals.boundaryHours = boundary!.hours!;
  return totals;
}

/** Reaching a configured boundary (including exactly zero) triggers review. */
export function boundaryExceeded(investments: InvestmentRecord[], boundary?: InvestmentBoundary): boolean {
  const totals = investmentTotals(investments, boundary);
  return (totals.boundaryAmountConfigured && totals.actualAmount >= totals.boundaryAmount)
    || (totals.boundaryHoursConfigured && totals.actualHours >= totals.boundaryHours);
}

/** Calendar dates use the user's local day rather than a UTC ISO slice. */
export function localDate(at: Date = new Date()): string {
  return `${at.getFullYear().toString().padStart(4, "0")}-${(at.getMonth() + 1).toString().padStart(2, "0")}-${at.getDate().toString().padStart(2, "0")}`;
}

export function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && localDate(date) === value;
}

function isTimestamp(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && isDateOnly(value.slice(0, 10)) && Number.isFinite(new Date(value).getTime());
}

/** A due date covers the full local day. Settlement becomes available the following day. */
export function isPredictionDue(prediction: Prediction, asOf = new Date().toISOString()): boolean {
  return isDateOnly(prediction.dueDate) && isTimestamp(asOf) && localDate(new Date(asOf)) > prediction.dueDate;
}

export function validateInvestmentRecord(item: InvestmentRecord, actualAmount = 0): string[] {
  const errors: string[] = [];
  if (item.currency !== "CNY") errors.push("金额只能使用人民币（CNY）");
  if (!["planned", "actual", "recoverable", "boundary"].includes(item.kind)) errors.push("投入类别无效");
  if (item.amount !== null && !nonNegative(item.amount)) errors.push("金额必须是非负有限数值");
  if (item.hours !== null && !nonNegative(item.hours)) errors.push("时间必须是非负有限数值");
  if (item.kind === "recoverable" && item.amount !== null && item.amount > actualAmount) errors.push("可回收金额不能超过实际金额");
  if (item.kind === "recoverable" && item.hours !== null) errors.push("时间投入不可回收");
  if (item.kind === "boundary" && item.amount === null && item.hours === null) errors.push("边界至少需要金额或小时中的一个");
  if (!isDateOnly(item.recordedAt)) errors.push("投入记录日期无效");
  return errors;
}

export function validateVerificationTask(task: VerificationTask): string[] {
  const errors: string[] = [];
  if (task.costAmount !== null && !nonNegative(task.costAmount)) errors.push("验证成本必须是非负有限数值");
  if (task.costUnit !== "CNY" && task.costUnit !== "hour") errors.push("验证成本单位只能是人民币或小时");
  if (!["open", "in_progress", "verified", "discarded"].includes(task.status)) errors.push("验证状态无效");
  if (task.dueDate && !isDateOnly(task.dueDate)) errors.push("验证截止日期无效");
  if (task.status === "verified" && !task.finding.trim()) errors.push("请先填写验证结果，再标记为已验证");
  if (!isTimestamp(task.updatedAt)) errors.push("验证更新时间无效");
  return errors;
}

function validatePrediction(prediction: Prediction, asOf: string): string[] {
  const errors: string[] = [];
  const now = new Date(asOf).getTime();
  if (!isTimestamp(prediction.createdAt) || new Date(prediction.createdAt).getTime() > now) errors.push("预测创建时间无效或在未来");
  if (prediction.probability !== null && (!Number.isFinite(prediction.probability) || prediction.probability < 0 || prediction.probability > 1)) errors.push("概率必须在 0 到 1 之间");
  if (prediction.dueDate && !isDateOnly(prediction.dueDate)) errors.push("预测截止日期无效");
  if (prediction.outcome !== null && typeof prediction.outcome !== "boolean") errors.push("预测结果只能是发生或未发生");
  if (!prediction.sealedAt) {
    if (prediction.outcome !== null || prediction.scoredAt || prediction.outcomeEvidence?.trim()) errors.push("未封存的预测不能记录结果");
    return errors;
  }
  if (!isTimestamp(prediction.sealedAt) || new Date(prediction.sealedAt).getTime() > now || new Date(prediction.sealedAt).getTime() < new Date(prediction.createdAt).getTime()) errors.push("预测封存时间无效");
  if (!prediction.statement.trim() || prediction.probability === null || !(prediction.basis ?? prediction.evidence).trim()) errors.push("封存预测必须有陈述、概率和事前依据");
  if (!isDateOnly(prediction.dueDate) || !isTimestamp(prediction.sealedAt) || prediction.dueDate <= localDate(new Date(prediction.sealedAt))) errors.push("封存时截止日期必须严格晚于当天");
  if (prediction.outcome === null) {
    if (prediction.scoredAt) errors.push("未结算预测不能有结算时间");
  } else {
    if (!prediction.outcomeEvidence?.trim()) errors.push("结算必须有结果证据");
    if (!isTimestamp(prediction.scoredAt) || new Date(prediction.scoredAt).getTime() > now || new Date(prediction.scoredAt).getTime() < new Date(prediction.sealedAt).getTime() || !isPredictionDue(prediction, prediction.scoredAt)) errors.push("结算时间必须在截止日结束之后，且不能在未来");
  }
  return errors;
}

const reviewFields = ["id", "date", "judgment", "execution", "externalChange", "nextStep", "createdAt"] as const;
function validateReview(review: DecisionReview, asOf: string, isDraft = false): string[] {
  const errors: string[] = [];
  if ((!isDraft || review.date) && !isDateOnly(review.date)) errors.push("复盘日期无效");
  if (review.date > localDate(new Date(asOf))) errors.push("复盘日期不能在未来");
  if (!isDraft) {
    if (!review.judgment.trim() && !review.execution.trim() && !review.externalChange.trim() && !review.nextStep.trim()) errors.push("复盘至少填写一项");
    if (!isTimestamp(review.createdAt) || new Date(review.createdAt).getTime() > new Date(asOf).getTime()) errors.push("复盘创建时间无效或在未来");
  }
  return errors;
}

export type WorkflowValidation = { valid: boolean; errors: string[] };
/** Semantic validation after the application has checked the imported object shape. */
export function validateWorkflow(workflow: DecisionWorkflow, asOf = new Date().toISOString()): WorkflowValidation {
  const errors: string[] = [];
  if (!isTimestamp(asOf)) return { valid: false, errors: ["当前时间无效"] };
  for (const collection of [workflow.verificationTasks, workflow.investments, workflow.predictions, workflow.reviews]) {
    const ids = collection.map((entry) => entry.id);
    if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) errors.push("工作区记录 ID 不能为空或重复");
  }
  for (const task of workflow.verificationTasks) errors.push(...validateVerificationTask(task).map((error) => `验证任务：${error}`));
  const totals = investmentTotals(workflow.investments, workflow.investmentBoundary);
  for (const item of workflow.investments) errors.push(...validateInvestmentRecord(item, totals.actualAmount).map((error) => `投入：${error}`));
  if (totals.recoverableAmount > totals.actualAmount) errors.push("累计可回收金额不能超过累计实际金额");
  if (Object.values(totals).some((value) => typeof value === "number" && !Number.isFinite(value))) errors.push("投入合计超出可计算范围");
  const boundary = workflow.investmentBoundary;
  if (boundary) {
    if (boundary.amount !== null && !nonNegative(boundary.amount)) errors.push("金额边界必须是非负有限数值");
    if (boundary.hours !== null && !nonNegative(boundary.hours)) errors.push("小时边界必须是非负有限数值");
  }
  if (workflow.actionPlan?.reviewDate && !isDateOnly(workflow.actionPlan.reviewDate)) errors.push("行动计划复评日期无效");
  for (const prediction of workflow.predictions) errors.push(...validatePrediction(prediction, asOf).map((error) => `预测：${error}`));
  for (const review of workflow.reviews) errors.push(...validateReview(review, asOf).map((error) => `复盘：${error}`));
  if (workflow.reviewDraft) errors.push(...validateReview(workflow.reviewDraft, asOf, true).map((error) => `复盘草稿：${error}`));
  return { valid: errors.length === 0, errors };
}

export type WorkflowTransitionOptions = {
  /** Allow a valid sealed/settled state to be replayed after its first persistence failed. */
  allowSealedReplay?: boolean;
};

function isValidSealedReplay(previous: Prediction, next: Prediction): boolean {
  if (!next.sealedAt || next.outcome === null || !next.scoredAt) return false;
  const previousBasis = previous.basis ?? previous.evidence;
  const nextBasis = next.basis ?? next.evidence;
  return previous.statement === next.statement
    && previous.probability === next.probability
    && previous.dueDate === next.dueDate
    && previous.createdAt === next.createdAt
    && previousBasis === nextBasis
    && previous.evidence === next.evidence
    && previous.outcome === null
    && !previous.scoredAt
    && !previous.outcomeEvidence?.trim();
}

/** Protect sealed forecasts and append-only records across ordinary edits and imports. */
export function validateWorkflowTransition(previous: DecisionWorkflow, next: DecisionWorkflow, asOf = new Date().toISOString(), options: WorkflowTransitionOptions = {}): WorkflowValidation {
  const errors = [...validateWorkflow(next, asOf).errors];
  const lockedFields = ["statement", "probability", "dueDate", "basis", "evidence", "createdAt", "sealedAt"] as const;
  const settledFields = [...lockedFields, "outcome", "outcomeEvidence", "scoredAt"] as const;
  for (const old of previous.predictions) {
    const item = next.predictions.find((candidate) => candidate.id === old.id);
    if (old.sealedAt) {
      if (!item) errors.push("已封存预测不能移除");
      else if ((old.outcome !== null ? settledFields : lockedFields).some((key) => old[key] !== item[key])) errors.push(old.outcome !== null ? "已结算预测不能修改" : "已封存预测的原始信息不能修改");
    }
  }
  for (const item of next.predictions) {
    const old = previous.predictions.find((candidate) => candidate.id === item.id);
    // Evidence may arrive in the same render as sealing. An outcome still
    // requires a separately persisted sealed forecast and a due-date check.
    if (!old?.sealedAt && item.sealedAt && (item.outcome !== null || item.scoredAt)
      && !(options.allowSealedReplay && isValidSealedReplay(old ?? item, item))) {
      errors.push("请先封存预测，之后再记录结果");
    }
  }
  if (next.reviews.length < previous.reviews.length || previous.reviews.some((old, index) => !next.reviews[index] || reviewFields.some((key) => old[key] !== next.reviews[index][key]))) errors.push("已追加的复盘记录不能修改、移除或重排");
  return { valid: errors.length === 0, errors };
}

export function sealPrediction(prediction: Prediction, at = new Date().toISOString()): Prediction {
  if (prediction.sealedAt) throw new Error("预测已经封存，不能再次编辑");
  if (prediction.outcome !== null || prediction.scoredAt || prediction.outcomeEvidence?.trim()) throw new Error("封存前不能已有结果");
  const sealed = { ...prediction, basis: prediction.basis ?? prediction.evidence, sealedAt: at };
  const errors = isTimestamp(at) ? validatePrediction(sealed, at) : ["封存时间无效"];
  if (errors.length) throw new Error(errors.join("；"));
  return sealed;
}

export function settlePrediction(prediction: Prediction, outcome: boolean, outcomeEvidence: string, asOf = new Date().toISOString()): Prediction {
  if (!prediction.sealedAt) throw new Error("预测必须先封存");
  if (prediction.outcome !== null || prediction.scoredAt) throw new Error("预测已经结算，不能修改");
  if (!isPredictionDue(prediction, asOf)) throw new Error("截止日期尚未结束，不能结算预测");
  if (!outcomeEvidence.trim()) throw new Error("结算需要填写结果证据");
  const settled = { ...prediction, outcome, outcomeEvidence: outcomeEvidence.trim(), scoredAt: asOf };
  const errors = validatePrediction(settled, asOf);
  if (errors.length) throw new Error(errors.join("；"));
  return settled;
}

export function appendReview(workflow: DecisionWorkflow, review: DecisionReview, at = new Date().toISOString()): DecisionWorkflow {
  const record = { ...review, createdAt: at };
  const errors = isTimestamp(at) ? validateReview(record, at) : ["复盘创建时间无效"];
  if (errors.length) throw new Error(errors.join("；"));
  if (workflow.reviews.some((existing) => existing.id === record.id)) throw new Error("复盘记录 ID 不能重复");
  return { ...workflow, reviewDraft: undefined, reviews: [...workflow.reviews, record] };
}

/** Mean squared probability error for valid settled forecasts, not a decision-quality score. */
export function brierScore(predictions: Prediction[], asOf = new Date().toISOString()): number | undefined {
  if (!isTimestamp(asOf)) return undefined;
  const scored = predictions.filter((item) => !!item.sealedAt && item.outcome !== null && validatePrediction(item, asOf).length === 0);
  if (scored.length === 0) return undefined;
  return scored.reduce((sum, item) => sum + (item.probability! - (item.outcome ? 1 : 0)) ** 2, 0) / scored.length;
}


