import { describe, expect, it } from "vitest";
import {
  appendReview, brierScore, boundaryExceeded, emptyWorkflow, investmentTotals,
  isDateOnly, isPredictionDue, localDate, sealPrediction, settlePrediction,
  validateInvestmentRecord, validateVerificationTask, validateWorkflow, validateWorkflowTransition,
  type DecisionReview, type InvestmentRecord, type Prediction, type VerificationTask,
} from "./workflow";

const at = (day: string, time = "12:00:00") => new Date(`${day}T${time}`).toISOString();
const now = at("2026-09-22");
const investment = (change: Partial<InvestmentRecord>): InvestmentRecord => ({
  id: crypto.randomUUID(), label: "", kind: "actual", amount: null, currency: "CNY", hours: null, note: "", recordedAt: "2026-09-21", ...change,
});
const forecast = (change: Partial<Prediction> = {}): Prediction => ({
  id: "forecast", statement: "完成任务", probability: 0.7, outcome: null, dueDate: "2026-09-20", evidence: "", basis: "过去三次记录", createdAt: at("2026-09-01"), ...change,
});
const review = (change: Partial<DecisionReview> = {}): DecisionReview => ({
  id: "review", date: "2026-09-21", judgment: "当时信息支持选择", execution: "按计划完成", externalChange: "需求改变", nextStep: "先验证新需求", ...change,
});
const task = (change: Partial<VerificationTask> = {}): VerificationTask => ({
  id: "task", hypothesis: "", decisionImpact: "", method: "", source: "", costAmount: null, costUnit: "CNY", dueDate: "", status: "open", finding: "", updatedAt: now, ...change,
});
const sealedForecast = () => sealPrediction(forecast(), at("2026-09-10"));

describe("investment boundaries and units", () => {
  it("totals money and time independently and triggers review at exact equality", () => {
    const entries = [investment({ amount: 10000 }), investment({ hours: 3 })];
    expect(investmentTotals(entries, { amount: 10000, hours: 3 })).toMatchObject({ actualAmount: 10000, actualHours: 3, boundaryAmount: 10000, boundaryHours: 3 });
    expect(boundaryExceeded(entries, { amount: 10000, hours: null })).toBe(true);
    expect(boundaryExceeded(entries, { amount: null, hours: 3 })).toBe(true);
    expect(boundaryExceeded(entries, { amount: 10001, hours: 4 })).toBe(false);
  });

  it("distinguishes a zero ceiling from an unset ceiling", () => {
    expect(boundaryExceeded([], { amount: 0, hours: null })).toBe(true);
    expect(boundaryExceeded([], { amount: null, hours: 0 })).toBe(true);
    expect(boundaryExceeded([], { amount: null, hours: null })).toBe(false);
    expect(boundaryExceeded([])).toBe(false);
  });

  it("uses one latest legacy ceiling, never the sum of ceiling revisions", () => {
    const entries = [investment({ kind: "boundary", amount: 100 }), investment({ kind: "boundary", amount: 200 }), investment({ amount: 200 })];
    expect(investmentTotals(entries).boundaryAmount).toBe(200);
    expect(boundaryExceeded(entries)).toBe(true);
    expect(boundaryExceeded(entries, { amount: null, hours: null })).toBe(false);
  });

  it("rejects non-CNY money, negatives, non-finite inputs and recovery of time", () => {
    expect(validateInvestmentRecord(investment({ currency: "other", amount: 10 }))).toContain("金额只能使用人民币（CNY）");
    expect(investmentTotals([investment({ currency: "other", amount: 10 })]).actualAmount).toBe(0);
    for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(validateInvestmentRecord(investment({ amount }))).toContain("金额必须是非负有限数值");
    expect(validateInvestmentRecord(investment({ kind: "recoverable", hours: 0 }))).toContain("时间投入不可回收");
  });

  it("rejects cumulative recovery and reducing actual expense below recovery", () => {
    const entries = [investment({ id: "actual", amount: 100 }), investment({ kind: "recoverable", amount: 60 }), investment({ kind: "recoverable", amount: 50 })];
    expect(validateWorkflow({ ...emptyWorkflow(), investments: entries }, now).errors).toContain("累计可回收金额不能超过累计实际金额");
    const valid = { ...emptyWorkflow(), investments: entries.slice(0, 2) };
    expect(validateWorkflow(valid, now).valid).toBe(true);
    expect(validateWorkflowTransition(valid, { ...valid, investments: [investment({ id: "actual", amount: 40 }), entries[1]] }, now).valid).toBe(false);
  });
});

describe("calendar dates and verification", () => {
  it("checks real calendar dates and uses local today", () => {
    expect(isDateOnly("2024-02-29")).toBe(true);
    for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-9-01", "2026-09-01T12:00:00Z"]) expect(isDateOnly(date)).toBe(false);
    expect(localDate(new Date(2026, 8, 22, 0, 5))).toBe("2026-09-22");
  });

  it("requires a finding before marking a verification task complete", () => {
    expect(validateVerificationTask(task({ status: "verified" }))).toContain("请先填写验证结果，再标记为已验证");
    expect(validateVerificationTask(task({ status: "verified", finding: "观察结果" }))).toEqual([]);
    expect(validateVerificationTask(task({ costAmount: -1 }))).not.toEqual([]);
    expect(validateVerificationTask(task({ dueDate: "2026-02-30" }))).not.toEqual([]);
  });
});

describe("prospective forecasts", () => {
  it("seals a draft without mutating it and requires a strictly future due day", () => {
    const draft = forecast();
    const sealed = sealPrediction(draft, at("2026-09-10"));
    expect(draft.sealedAt).toBeUndefined();
    expect(sealed.probability).toBe(0.7);
    expect(() => sealPrediction(draft, at("2026-09-20"))).toThrow("严格晚于当天");
    expect(() => sealPrediction(draft, at("2026-09-21"))).toThrow("严格晚于当天");
    expect(() => sealPrediction(forecast({ dueDate: "2026-02-30" }), at("2026-09-10"))).toThrow();
  });

  it("rejects sealing known outcomes, absent probabilities, invalid and reversed timestamps", () => {
    expect(() => sealPrediction(forecast({ outcome: true }), at("2026-09-10"))).toThrow("已有结果");
    expect(() => sealPrediction(forecast({ outcomeEvidence: "已发生" }), at("2026-09-10"))).toThrow("已有结果");
    for (const probability of [null, -0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => sealPrediction(forecast({ probability }), at("2026-09-10"))).toThrow();
    expect(() => sealPrediction(forecast(), "invalid")).toThrow();
    expect(() => sealPrediction(forecast(), "2026-09-10T24:00:00Z")).toThrow();
    expect(() => sealPrediction(forecast(), at("2026-08-01"))).toThrow();
  });

  it("waits until the full local due date has ended, then requires separate result evidence", () => {
    const sealed = sealedForecast();
    expect(isPredictionDue(sealed, at("2026-09-20", "23:59:59"))).toBe(false);
    expect(isPredictionDue(sealed, at("2026-09-21", "00:00:00"))).toBe(true);
    expect(() => settlePrediction(sealed, true, "观察记录", at("2026-09-20", "23:59:59"))).toThrow("尚未结束");
    expect(() => settlePrediction(sealed, true, "", now)).toThrow("结果证据");
    const settled = settlePrediction(sealed, true, "观察记录", now);
    expect(settled.basis).toBe(sealed.basis);
    expect(settled.outcomeEvidence).toBe("观察记录");
    expect(() => settlePrediction(settled, false, "其他", now)).toThrow("已经结算");
  });

  it("allows outcome evidence edits on sealed forecasts while protecting original fields", () => {
    const original = { ...emptyWorkflow(), predictions: [sealedForecast()] };
    const withEvidence = { ...original, predictions: [{ ...original.predictions[0], outcomeEvidence: "观察记录" }] };
    expect(validateWorkflowTransition(original, withEvidence, now).valid).toBe(true);
    for (const change of [{ statement: "其他陈述" }, { probability: 0.9 }, { dueDate: "2026-09-19" }, { basis: "新的依据" }, { evidence: "回填" }, { createdAt: at("2026-09-02") }, { sealedAt: undefined }]) {
      expect(validateWorkflowTransition(original, { ...original, predictions: [{ ...original.predictions[0], ...change }] }, now).valid).toBe(false);
    }
    expect(validateWorkflowTransition(original, emptyWorkflow(), now).valid).toBe(false);
  });

  it("requires a separate sealed step and locks every settled field", () => {
    const sealed = sealedForecast();
    const settled = settlePrediction(sealed, true, "观察记录", now);
    expect(validateWorkflowTransition(emptyWorkflow(), { ...emptyWorkflow(), predictions: [settled] }, now).valid).toBe(false);
    expect(validateWorkflowTransition(emptyWorkflow(), { ...emptyWorkflow(), predictions: [sealed] }, now).valid).toBe(true);
    const before = { ...emptyWorkflow(), predictions: [sealed] };
    const after = { ...before, predictions: [settled] };
    expect(validateWorkflowTransition(before, after, now).valid).toBe(true);
    for (const change of [{ outcome: false }, { outcomeEvidence: "更换证据" }, { scoredAt: at("2026-09-21") }]) expect(validateWorkflowTransition(after, { ...after, predictions: [{ ...settled, ...change }] }, now).valid).toBe(false);
  });

  it("does not score unsealed, unresolved, premature, invalid or future settlements", () => {
    const settled = settlePrediction(sealedForecast(), true, "观察记录", now);
    expect(brierScore([settled], now)).toBeCloseTo(0.09);
    for (const invalid of [forecast({ outcome: true }), sealedForecast(), { ...settled, scoredAt: at("2026-09-20") }, { ...settled, scoredAt: at("2026-09-23") }, { ...settled, probability: 2 }, { ...settled, dueDate: "2026-02-30" }, { ...settled, outcomeEvidence: "" }]) expect(brierScore([invalid], now)).toBeUndefined();
  });

  it("rejects semantically invalid imported forecasts", () => {
    expect(validateWorkflow({ ...emptyWorkflow(), predictions: [forecast({ outcome: false })] }, now).valid).toBe(false);
    expect(validateWorkflow({ ...emptyWorkflow(), predictions: [{ ...sealedForecast(), probability: null }] }, now).valid).toBe(false);
    expect(validateWorkflow({ ...emptyWorkflow(), predictions: [forecast({ createdAt: at("2026-09-23") })] }, now).valid).toBe(false);
  });

  it("can persist a previously valid seal after a save retry crosses its due date", () => {
    const original = { ...emptyWorkflow(), predictions: [forecast()] };
    const pendingSave = { ...original, predictions: [sealPrediction(forecast(), at("2026-09-10"))] };
    expect(validateWorkflowTransition(original, pendingSave, at("2026-09-10")).valid).toBe(true);
    expect(validateWorkflowTransition(original, pendingSave, at("2026-09-21")).valid).toBe(true);
    expect(() => sealPrediction(forecast(), at("2026-09-21"))).toThrow("严格晚于当天");
  });
});

describe("persistent review drafts and immutable records", () => {
  it("preserves drafts in aggregate data and stamps only at actual append time", () => {
    const draft = review({ createdAt: at("2026-09-01") });
    const workflow = { ...emptyWorkflow(), reviewDraft: draft };
    const restored = JSON.parse(JSON.stringify(workflow));
    expect(restored.reviewDraft.judgment).toBe(draft.judgment);
    const appended = appendReview(restored, restored.reviewDraft, now);
    expect(appended.reviews[0].createdAt).toBe(now);
    expect(appended.reviewDraft).toBeUndefined();
    expect(workflow.reviewDraft).toBe(draft);
    expect(validateWorkflowTransition(workflow, appended, now).valid).toBe(true);
  });

  it("permits appending but rejects edited, deleted and reordered review history", () => {
    const previous = appendReview(emptyWorkflow(), review(), now);
    const appended = appendReview(previous, review({ id: "review2" }), now);
    expect(validateWorkflowTransition(previous, appended, now).valid).toBe(true);
    expect(validateWorkflowTransition(previous, emptyWorkflow(), now).valid).toBe(false);
    expect(validateWorkflowTransition(previous, { ...previous, reviews: [{ ...previous.reviews[0], judgment: "改写" }] }, now).valid).toBe(false);
    expect(validateWorkflowTransition(appended, { ...appended, reviews: [...appended.reviews].reverse() }, now).valid).toBe(false);
  });
});
