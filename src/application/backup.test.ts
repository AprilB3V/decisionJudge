import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBackup, prepareBackupImport, type BackupPayload } from "./backup";
import { createDecision, createPreset, createSnapshot, exportPayload } from "./decisionService";
import type { Decision } from "../domain/types";

const empty = (): BackupPayload => ({ decisions: [], snapshots: [], presets: [] });
const timestamp = "2026-09-20T00:00:00.000Z";

function decisionWithWorkflow(): Decision {
  const decision = createDecision("job-change");
  decision.createdAt = "2026-09-01T00:00:00.000Z";
  decision.updatedAt = timestamp;
  decision.scores = decision.scores.map((score) => ({
    ...score, value: 7, evidence: "书面录用说明", evidenceSource: "招聘方", evidenceDate: "2026-09-01",
    evidenceKind: "fact", evidenceConfidence: "high",
  }));
  decision.workflow = {
    verificationTasks: [{
      id: "verification-1", optionId: decision.options[0]!.id, criterionId: decision.criteria[0]!.id,
      hypothesis: "可参与核心项目", decisionImpact: "会改变工作匹配评分", method: "联系直属主管",
      source: "沟通记录", costAmount: 1, costUnit: "hour", dueDate: "2026-09-25", status: "open", finding: "", updatedAt: timestamp,
    }],
    investments: [
      { id: "investment-1", label: "试访", kind: "actual", amount: 100, currency: "CNY", hours: 2, note: "", recordedAt: "2026-09-05" },
      { id: "investment-2", label: "可退款", kind: "recoverable", amount: 25, currency: "CNY", hours: null, note: "", recordedAt: "2026-09-05" },
    ],
    investmentBoundary: { amount: 300, hours: 4 },
    actionPlan: { trigger: "晚饭后", action: "核对条件", when: "周四", where: "书桌", obstacle: "加班", fallback: "周六", reviewDate: "2026-09-25" },
    predictions: [{
      id: "prediction-1", statement: "能拿到书面条件", probability: 0.7, outcome: true, dueDate: "2026-09-10", evidence: "旧字段",
      basis: "对方承诺", outcomeEvidence: "已收到邮件", createdAt: "2026-09-01T00:00:00.000Z",
      sealedAt: "2026-09-02T00:00:00.000Z", scoredAt: "2026-09-11T00:00:00.000Z",
    }],
    reviews: [{ id: "review-1", date: "2026-09-15", judgment: "信息已补齐", execution: "已完成", externalChange: "无", nextStep: "比较条件", createdAt: "2026-09-15T00:00:00.000Z" }],
    reviewDraft: { id: "draft-review", date: "", judgment: "", execution: "", externalChange: "", nextStep: "" },
  };
  return decision;
}

function payloadFixture(): BackupPayload {
  const decision = decisionWithWorkflow();
  return {
    decisions: [decision],
    snapshots: [createSnapshot(decision, decision.options[0]!.id)],
    presets: [createPreset(decision, "换工作预设")],
  };
}

function encode(payload: BackupPayload): string {
  return exportPayload(payload.decisions, payload.snapshots, payload.presets);
}

afterEach(() => vi.restoreAllMocks());

describe("parseBackup", () => {
  it("round-trips the full workflow, evidence fields and optional extensions", () => {
    const payload = payloadFixture();
    Object.assign(payload.decisions[0]!, { optionalFutureField: { preserved: true } });
    Object.assign(payload.decisions[0]!.workflow!.actionPlan!, { reminderPreference: "manual" });
    const parsed = parseBackup(encode(payload));
    expect(parsed).toEqual(payload);
    expect(parsed.decisions[0]!.workflow?.reviewDraft?.id).toBe("draft-review");
  });

  it("reads old incomplete drafts without workflows or presets", () => {
    const decision = createDecision("blank");
    delete decision.workflow;
    const source = JSON.parse(exportPayload([decision], []));
    delete source.presets;
    const parsed = parseBackup(JSON.stringify(source));
    expect(parsed).toEqual({ decisions: [decision], snapshots: [], presets: [] });
    expect(parsed.decisions[0]).not.toHaveProperty("workflow");
  });

  it("accepts schema 2 without rewriting record or calculation versions", () => {
    const payload = payloadFixture();
    payload.decisions[0]!.schemaVersion = 2;
    const source = JSON.parse(encode(payload));
    source.schemaVersion = 2;
    expect(parseBackup(JSON.stringify(source)).decisions[0]!.schemaVersion).toBe(2);
    expect(parseBackup(JSON.stringify(source)).snapshots[0]!.schemaVersion).toBe(1);
  });

  it("preserves arbitrary historical results and the historical revision gap", () => {
    const payload = payloadFixture();
    const snapshot = payload.snapshots[0]!;
    snapshot.calculationVersion = "weighted-utility-v1";
    snapshot.decision.calculationVersion = "weighted-utility-v1";
    snapshot.result = {
      calculationVersion: "weighted-utility-v1", evaluatedRevision: snapshot.sourceRevision - 1,
      historicalOnly: { rows: [null, "old text", { score: 3.14159 }] },
    };
    expect(parseBackup(encode(payload)).snapshots[0]).toEqual(snapshot);
  });

  it.each([
    ["format", "other-format"], ["formatVersion", 2], ["schemaVersion", 0], ["schemaVersion", 3],
  ])("rejects unsupported envelope %s=%s", (field, value) => {
    const source = JSON.parse(encode(empty()));
    source[field] = value;
    expect(() => parseBackup(JSON.stringify(source))).toThrow("备份内容无效");
  });

  it("rejects newer nested schemas even when the envelope is supported", () => {
    const payload = payloadFixture();
    payload.snapshots[0]!.decision.schemaVersion = 3;
    expect(() => parseBackup(encode(payload))).toThrow("schemaVersion");
  });

  it("rejects malformed JSON, missing fields and incomplete workflow objects", () => {
    expect(() => parseBackup("{" )).toThrow("JSON");
    const payload = payloadFixture();
    delete (payload.decisions[0]!.workflow as unknown as Record<string, unknown>).predictions;
    expect(() => parseBackup(encode(payload))).toThrow("predictions");
    const source = JSON.parse(encode(payloadFixture()));
    delete source.snapshots[0].result;
    expect(() => parseBackup(JSON.stringify(source))).toThrow();
  });

  it("rejects negative weights, out-of-range scores and numeric overflow", () => {
    const payload = payloadFixture();
    payload.decisions[0]!.criteria[0]!.weight = -0.1;
    expect(() => parseBackup(encode(payload))).toThrow();
    payload.decisions[0]!.criteria[0]!.weight = 0.1;
    payload.decisions[0]!.scores[0]!.value = 11;
    expect(() => parseBackup(encode(payload))).toThrow();
    payload.decisions[0]!.scores[0]!.value = null;
    const overflowing = encode(payload).replace('"weight": 0.1', '"weight": 1e999');
    expect(() => parseBackup(overflowing)).toThrow();
  });

  it.each(["option", "criterion", "score", "constraint", "chosen", "task", "top-level"])("rejects duplicate or dangling %s data", (kind) => {
    const payload = payloadFixture();
    const decision = payload.decisions[0]!;
    if (kind === "option") decision.options.push({ ...decision.options[0]! });
    if (kind === "criterion") decision.scores[0]!.criterionId = "missing";
    if (kind === "score") decision.scores.push({ ...decision.scores[0]! });
    if (kind === "constraint") decision.constraints.push({ id: "c", label: "预算", description: "", evaluations: { missing: "feasible" } });
    if (kind === "chosen") decision.chosenOptionId = "missing";
    if (kind === "task") decision.workflow!.verificationTasks[0]!.optionId = "missing";
    if (kind === "top-level") payload.presets[0]!.id = decision.id;
    expect(() => parseBackup(encode(payload))).toThrow();
  });

  it("rejects workflow semantic corruption after validating its shape", () => {
    const payload = payloadFixture();
    payload.decisions[0]!.workflow!.investments[1]!.amount = 101;
    expect(() => parseBackup(encode(payload))).toThrow("可回收");
    payload.decisions[0]!.workflow!.investments[1]!.amount = 25;
    payload.decisions[0]!.workflow!.predictions[0]!.sealedAt = undefined;
    expect(() => parseBackup(encode(payload))).toThrow("未封存");
  });
});

describe("prepareBackupImport", () => {
  it("keeps new IDs, clones inputs and preserves result data", () => {
    const payload = payloadFixture();
    const result = prepareBackupImport(payload, empty());
    expect(result).toEqual(payload);
    result.decisions[0]!.title = "edited copy";
    expect(payload.decisions[0]!.title).not.toBe("edited copy");
  });

  it("remaps conflicts consistently without replacing decisions, presets or historical snapshots", () => {
    const payload = payloadFixture();
    const existing = structuredClone(payload);
    existing.decisions[0]!.title = "local version";
    const before = structuredClone(payload);
    const imported = prepareBackupImport(payload, existing);
    expect(imported.decisions[0]!.id).not.toBe(payload.decisions[0]!.id);
    expect(imported.snapshots[0]!.id).not.toBe(payload.snapshots[0]!.id);
    expect(imported.presets[0]!.id).not.toBe(payload.presets[0]!.id);
    expect(imported.snapshots[0]!.decisionId).toBe(imported.decisions[0]!.id);
    expect(imported.snapshots[0]!.decision.id).toBe(imported.decisions[0]!.id);
    expect(imported.snapshots[0]!.result).toEqual(payload.snapshots[0]!.result);
    expect(imported.snapshots[0]!.sourceRevision).toBe(payload.snapshots[0]!.sourceRevision);
    expect(payload).toEqual(before);
    expect(existing.decisions[0]!.title).toBe("local version");
  });

  it("keeps orphan snapshots while separating their source from existing decisions", () => {
    const payload = payloadFixture();
    const localDecision = payload.decisions[0]!;
    const secondSnapshot = structuredClone(payload.snapshots[0]!);
    secondSnapshot.id = "second-history";
    payload.decisions = [];
    payload.snapshots.push(secondSnapshot);
    const imported = prepareBackupImport(payload, { ...empty(), decisions: [localDecision] });
    expect(imported.decisions).toEqual([]);
    expect(imported.snapshots).toHaveLength(2);
    expect(imported.snapshots[0]!.decisionId).not.toBe(localDecision.id);
    expect(imported.snapshots[1]!.decisionId).toBe(imported.snapshots[0]!.decisionId);
    expect(imported.snapshots.every((snapshot) => snapshot.decision.id === snapshot.decisionId)).toBe(true);
  });

  it("does not attach an imported decision to an existing orphan snapshot source", () => {
    const payload = payloadFixture();
    const imported = prepareBackupImport({ ...empty(), decisions: payload.decisions }, { ...empty(), snapshots: payload.snapshots });
    expect(imported.decisions[0]!.id).not.toBe(payload.snapshots[0]!.decisionId);
  });

  it("retries generated UUIDs that collide with existing or incoming IDs", () => {
    const payload = payloadFixture();
    const originalId = payload.decisions[0]!.id;
    const reservedIncoming = payload.snapshots[0]!.id;
    const fresh = "11111111-2222-4333-8444-555555555555";
    const generator = vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(originalId as ReturnType<typeof crypto.randomUUID>)
      .mockReturnValueOnce(reservedIncoming as ReturnType<typeof crypto.randomUUID>)
      .mockReturnValueOnce(fresh);
    const imported = prepareBackupImport(payload, { ...empty(), decisions: [payload.decisions[0]!] });
    expect(imported.decisions[0]!.id).toBe(fresh);
    expect(generator).toHaveBeenCalledTimes(3);
    expect(new Set([imported.decisions[0]!.id, imported.snapshots[0]!.id, imported.presets[0]!.id]).size).toBe(3);
  });

  it("validates direct-call payloads before preparing an import", () => {
    const payload = payloadFixture();
    payload.decisions[0]!.criteria[0]!.weight = Number.NaN;
    expect(() => prepareBackupImport(payload, empty())).toThrow();
  });
});
