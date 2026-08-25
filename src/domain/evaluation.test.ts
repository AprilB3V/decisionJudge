import { describe, expect, it } from "vitest";
import { createDecision } from "../application/decisionService";
import { evaluateDecision } from "./evaluation";

function completedDecision() {
  const decision = createDecision("study-or-work");
  return {
    ...decision,
    scores: decision.scores.map((score) => ({
      ...score,
      value: score.optionId === decision.options[0]?.id
        ? ({ [decision.criteria[0]!.id]: 9, [decision.criteria[1]!.id]: 6, [decision.criteria[2]!.id]: 8, [decision.criteria[3]!.id]: 5, [decision.criteria[4]!.id]: 7 }[score.criterionId] ?? 7)
        : score.optionId === decision.options[1]?.id
          ? ({ [decision.criteria[0]!.id]: 7, [decision.criteria[1]!.id]: 9, [decision.criteria[2]!.id]: 6, [decision.criteria[3]!.id]: 7, [decision.criteria[4]!.id]: 6 }[score.criterionId] ?? 7)
          : 5,
    })),
  };
}

describe("evaluateDecision", () => {
  it("excludes sunk costs from future utility and explains them", () => {
    const decision = completedDecision();
    const base = evaluateDecision(decision);
    const withSunkCost = evaluateDecision({ ...decision, sunkCosts: [{ id: "cost-1", label: "已经支付的申请费", category: "money", amount: 500, unit: "元", incurredAt: "2026-01-01", recoverable: false, note: "" }] });
    expect(withSunkCost.rows).toEqual(base.rows);
    expect(withSunkCost.notices.some((notice) => notice.concept === "sunk")).toBe(true);
  });

  it("reports the best foregone alternative without double-counting it", () => {
    const result = evaluateDecision(completedDecision());
    const winner = result.rows[0]!;
    expect(winner.bestForegoneOptionId).toBe(result.rows[1]!.optionId);
    expect(winner.bestForegoneUtility).toBe(result.rows[1]!.utility);
    expect(winner.netAdvantageOverNextBest).toBeCloseTo(winner.utility - result.rows[1]!.utility, 2);
  });

  it("marks the conclusion as sensitive when a small weight change flips the winner", () => {
    const decision = completedDecision();
    const criteria = decision.criteria.map((criterion, index) => ({ ...criterion, weight: index === 0 ? 0.5 : index === 1 ? 0.3 : index === 2 ? 0.1 : index === 3 ? 0.05 : 0.05 }));
    const result = evaluateDecision({ ...decision, criteria });
    expect(result.ready).toBe(true);
    expect(["stable", "sensitive"]).toContain(result.stability);
  });

  it("returns actionable errors for incomplete drafts", () => {
    const result = evaluateDecision(createDecision("study-or-work"));
    expect(result.ready).toBe(false);
    expect(result.errors).toContain("请为每个可行方案的每个维度填写 1-10 分。");
  });
});
