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
    expect(result.rows).toEqual([]);
  });

  it("keeps sensitivity weights aligned by criterion id when a zero weight is in the middle", () => {
    const decision = completedDecision();
    const options = decision.options.slice(0, 2);
    const criteria = decision.criteria.map((criterion, index) => ({
      ...criterion,
      weight: index === 1 ? 0.2 : index === 2 ? 0.8 : 0,
    }));
    const scores = decision.scores
      .filter((score) => options.some((option) => option.id === score.optionId))
      .map((score) => {
        const optionIndex = options.findIndex((option) => option.id === score.optionId);
        const criterionIndex = criteria.findIndex((criterion) => criterion.id === score.criterionId);
        const values = criterionIndex === 0 ? [5, 5] : criterionIndex === 1 ? [10, 5] : criterionIndex === 2 ? [9, 10] : [5, 5];
        return { ...score, value: values[optionIndex] };
      });
    const result = evaluateDecision({ ...decision, options, criteria, scores });
    expect(result.ready).toBe(true);
    expect(result.stability).toBe("sensitive");
    const winner = result.rows[0]!;
    expect(winner.relativeContributions?.find((item) => item.criterionId === criteria[1]!.id)?.weightedDifference).toBeCloseTo(1, 8);
    expect(winner.relativeContributions?.find((item) => item.criterionId === criteria[2]!.id)?.weightedDifference).toBeCloseTo(-0.8, 8);
  });

  it("rejects invalid weights and non-finite scores without returning rows", () => {
    const decision = completedDecision();
    const invalidWeight = evaluateDecision({
      ...decision,
      criteria: decision.criteria.map((criterion, index) => index === 0 ? { ...criterion, weight: Number.NaN } : criterion),
    });
    expect(invalidWeight.ready).toBe(false);
    expect(invalidWeight.rows).toEqual([]);
    expect(invalidWeight.errors).toContain("评价维度权重必须是有限的非负数。");

    const invalidScore = evaluateDecision({
      ...decision,
      scores: decision.scores.map((score, index) => index === 0 ? { ...score, value: Number.NaN } : score),
    });
    expect(invalidScore.ready).toBe(false);
    expect(invalidScore.rows).toEqual([]);
    expect(invalidScore.errors).toContain("评分必须是有限的数字。");
  });

  it("retains pending constraints in a conditional ranking and explains unused advanced switches", () => {
    const decision = completedDecision();
    const firstOption = decision.options[0]!;
    const secondOption = decision.options[1]!;
    const result = evaluateDecision({
      ...decision,
      constraints: [{ id: "constraint-1", label: "必须有书面录用条件", description: "", evaluations: { [firstOption.id]: "unknown", [secondOption.id]: "feasible" } }],
      advanced: { ...decision.advanced, scenariosEnabled: true },
    });
    expect(result.ready).toBe(true);
    expect(result.rows.length).toBe(3);
    expect(result.pendingConstraintOptionIds).toContain(firstOption.id);
    expect(result.notices.find((notice) => notice.concept === "constraint")?.title).toBe("存在待核实约束");
    expect(result.activeAdvancedModules).toEqual([]);
    expect(result.notices.find((notice) => notice.concept === "advanced")?.body).toContain("未参与");
  });

  it("gives tied first options the same rank", () => {
    const decision = completedDecision();
    const result = evaluateDecision({ ...decision, scores: decision.scores.map((score) => ({ ...score, value: 5 })) });
    expect(result.ready).toBe(true);
    expect(result.rows.every((row) => row.rank === 1)).toBe(true);
    expect(result.tiedFirstOptionIds).toHaveLength(3);
  });

  it("ignores missing scores in zero-weight dimensions and known-infeasible options", () => {
    const decision = completedDecision();
    const excluded = decision.options[2]!.id;
    decision.criteria = decision.criteria.map((criterion, index) => ({ ...criterion, weight: index === 0 ? 1 : 0 }));
    decision.scores = decision.scores.filter((score) => score.optionId !== excluded && score.criterionId === decision.criteria[0]!.id);
    decision.constraints = [{ id: "constraint", label: "底线", description: "", evaluations: Object.fromEntries(decision.options.map((option) => [option.id, option.id === excluded ? "infeasible" as const : "feasible" as const])) }];
    const result = evaluateDecision(decision);
    expect(result.ready).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.some((row) => row.optionId === excluded)).toBe(false);
    expect(result.stabilityDescription).toContain("只有一个正权重维度");
    expect(result.rows[0]!.relativeContributions).toHaveLength(1);
  });

  it("distinguishes close ranks even when the displayed scores round to the same value", () => {
    const decision = completedDecision();
    decision.criteria = decision.criteria.map((criterion, index) => ({ ...criterion, weight: index === 0 ? 1 : 0 }));
    decision.scores = decision.scores.map((score) => ({ ...score, value: score.optionId === decision.options[0]!.id ? 7.004 : score.optionId === decision.options[1]!.id ? 7.003 : 5 }));
    const result = evaluateDecision(decision);
    expect(result.rows[0]!.utility).toBe(result.rows[1]!.utility);
    expect(result.rows[0]!.rank).toBe(1);
    expect(result.rows[1]!.rank).toBe(2);
    expect(result.tiedFirstOptionIds).toEqual([]);
  });

  it("checks both directions of small weights without assigning negative residual weight", () => {
    const decision = completedDecision();
    decision.options = decision.options.slice(0, 2);
    decision.criteria = decision.criteria.slice(0, 2).map((criterion, index) => ({ ...criterion, weight: index === 0 ? 0.01 : 0.99 }));
    decision.scores = decision.options.flatMap((option, optionIndex) => decision.criteria.map((criterion, criterionIndex) => ({ optionId: option.id, criterionId: criterion.id, value: [[10, 6], [1, 6.1]][optionIndex]![criterionIndex]!, evidence: "" })));
    const result = evaluateDecision(decision);
    expect(result.ready).toBe(true);
    expect(result.rows[0]!.optionId).toBe(decision.options[1]!.id);
    expect(result.stability).toBe("sensitive");
    expect(result.stabilityDescription).toContain("上下 5 个百分点");
    expect(result.rows.every((row) => Number.isFinite(row.utility))).toBe(true);
  });

  it("recognizes when small weight changes break an exact tie", () => {
    const decision = completedDecision();
    decision.options = decision.options.slice(0, 2);
    decision.criteria = decision.criteria.slice(0, 2).map((criterion) => ({ ...criterion, weight: 0.5 }));
    decision.scores = decision.options.flatMap((option, optionIndex) => decision.criteria.map((criterion, criterionIndex) => ({ optionId: option.id, criterionId: criterion.id, value: optionIndex === criterionIndex ? 9 : 5, evidence: "" })));
    const result = evaluateDecision(decision);
    expect(result.rows.map((row) => row.rank)).toEqual([1, 1]);
    expect(result.stability).toBe("sensitive");
    const alwaysTied = evaluateDecision({ ...decision, scores: decision.scores.map((score) => ({ ...score, value: 7 })) });
    expect(alwaysTied.stability).toBe("stable");
  });

  it("keeps relative contributions consistent with the unrounded advantage", () => {
    const decision = completedDecision();
    const result = evaluateDecision(decision);
    for (const row of result.rows) {
      const difference = row.relativeContributions!.reduce((sum, item) => sum + item.weightedDifference, 0);
      expect(Math.round(difference * 100) / 100).toBe(row.netAdvantageOverNextBest);
      for (const item of row.relativeContributions!) {
        const weight = decision.criteria.find((criterion) => criterion.id === item.criterionId)!.weight;
        expect(item.weightedDifference).toBeCloseTo((item.score - item.alternativeScore) * weight, 10);
      }
    }
  });

  it.each([-0.01, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("rejects invalid weight %s", (weight) => {
    const decision = completedDecision();
    decision.criteria[0]!.weight = weight;
    const result = evaluateDecision(decision);
    expect(result.ready).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.stability).toBe("insufficient_data");
  });

  it("never returns a comparison score above ten for near-unit accepted weight totals", () => {
    const decision = completedDecision();
    decision.criteria = decision.criteria.map((criterion) => ({ ...criterion, weight: criterion.weight * 1.0009 }));
    decision.scores = decision.scores.map((score) => ({ ...score, value: 10 }));
    const result = evaluateDecision(decision);
    if (result.ready) {
      expect(result.rows.every((row) => row.utility <= 10)).toBe(true);
      expect(result.rows.every((row) => row.utility >= 1)).toBe(true);
    } else {
      expect(result.errors).toContain("评价维度权重需要合计 100%。");
    }
  });

  it("normalizes tolerated weight noise consistently for basic and relative contributions", () => {
    const decision = completedDecision();
    const baseline = evaluateDecision(decision);
    const noisy = evaluateDecision({ ...decision, criteria: decision.criteria.map((criterion) => ({ ...criterion, weight: criterion.weight * 1.0009 })) });
    expect(noisy.ready).toBe(true);
    expect(noisy.stability).toBe(baseline.stability);
    expect(noisy.rows.map((row) => [row.optionId, row.utility, row.netAdvantageOverNextBest])).toEqual(baseline.rows.map((row) => [row.optionId, row.utility, row.netAdvantageOverNextBest]));
    noisy.rows.forEach((row, rowIndex) => {
      row.relativeContributions!.forEach((item, itemIndex) => {
        const expected = baseline.rows[rowIndex]!.relativeContributions![itemIndex]!;
        expect(item.weightedContribution).toBeCloseTo(expected.weightedContribution, 12);
        expect(item.weightedDifference).toBeCloseTo(expected.weightedDifference, 12);
      });
    });
  });
});
