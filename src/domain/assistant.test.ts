import { describe, expect, it } from "vitest";
import { assistantContext, comparisonFingerprint, parseAssistantReply, proposalChange, type DesignProposal } from "./assistant";
import { applyDecisionChange, createDecision, createSnapshot, exportPayload } from "../application/decisionService";
import { parseBackup } from "../application/backup";

export const sampleProposal = (): DesignProposal => ({
  title: "去留选择", objective: "兼顾成长和生活",
  options: [{ name: "新机会", description: "了解职责", isStatusQuo: false }, { name: "留任", description: "继续积累", isStatusQuo: true }],
  criteria: [{ name: "成长", description: "偏好待确认", weight: 60, lowAnchor: "停滞", highAnchor: "能力增长" }, { name: "生活", description: "时间可控", weight: 30, lowAnchor: "失衡", highAnchor: "可持续" }],
  constraints: [{ label: "收入满足基本支出", description: "核实书面条件" }],
});

describe("assistant design boundary", () => {
  it("accepts questions and validates fenced proposals without trusting arbitrary fields", () => {
    expect(parseAssistantReply("你最在意什么？")).toEqual({ message: "你最在意什么？", proposal: null });
    const text = "```json\n" + JSON.stringify({ message: "请核对权衡", proposal: { ...sampleProposal(), workflow: { reviews: [] } } }) + "\n```";
    expect(parseAssistantReply(text).proposal).toEqual(sampleProposal());
  });
  it.each([
    { options: [{ name: "唯一方案", description: "", isStatusQuo: false }] },
    { criteria: [{ name: "成长", description: "", weight: -1, lowAnchor: "", highAnchor: "" }] },
    { criteria: [{ name: "成长", description: "", weight: 0, lowAnchor: "", highAnchor: "" }] },
    { options: [{ name: "相同", description: "", isStatusQuo: false }, { name: "相同 ", description: "", isStatusQuo: false }] },
    { objective: "" },
  ])("rejects malformed or unsafe structures %j", (invalid) => {
    expect(() => parseAssistantReply(JSON.stringify({ message: "草稿", proposal: { ...sampleProposal(), ...invalid } }))).toThrow("草稿结构");
  });
  it("projects only active comparison details without credentials, evidence or workflow", () => {
    const decision = createDecision("job-change");
    decision.scores[0].evidence = "私人访谈细节";
    decision.workflow!.actionPlan = { trigger: "私人记录", action: "", when: "", where: "", obstacle: "", fallback: "", reviewDate: "" };
    const serialized = JSON.stringify(assistantContext(decision));
    expect(serialized).not.toContain("私人");
    expect(serialized).not.toContain(decision.id);
    expect(serialized).toContain(decision.title);
  });
  it("applies as a draft with normalized weights, unknown constraints, empty scores and preserved history", () => {
    let decision = createDecision("job-change");
    decision.scores.forEach((score) => { score.value = 8; });
    const snapshot = createSnapshot(decision, decision.options[0].id);
    decision = snapshot.decision;
    const before = JSON.stringify(snapshot);
    const updated = applyDecisionChange(decision, proposalChange(sampleProposal()));
    expect(updated.status).toBe("draft");
    expect(updated.chosenOptionId).toBeUndefined();
    expect(updated.id).toBe(decision.id);
    expect(updated.workflow).toEqual(decision.workflow);
    expect(updated.criteria.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1);
    expect(updated.constraints[0].evaluations).toEqual({});
    expect(updated.scores).toHaveLength(4);
    expect(updated.scores.every((score) => score.value === null)).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(parseBackup(exportPayload([updated], [snapshot])).decisions[0]).toEqual(updated);
  });
  it("detects intervening score changes but ignores mode and autosave revision", () => {
    const decision = createDecision("job-change");
    const original = comparisonFingerprint(decision);
    expect(comparisonFingerprint({ ...decision, revision: 99, advancedUiExpanded: true })).toBe(original);
    decision.scores[0].value = 9;
    expect(comparisonFingerprint(decision)).not.toBe(original);
  });
});
