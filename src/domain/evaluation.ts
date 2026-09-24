import type {
  Decision,
  EvaluationResult,
  Contribution,
  EvaluationRow,
  Criterion,
  RelativeContribution,
  UUID,
} from "./types";

export const CALCULATION_VERSION = "weighted-utility-v2";

const EPSILON = 1e-9;
const round = (value: number) => Math.round(value * 100) / 100;

type ScoredRow = {
  optionId: UUID;
  utility: number;
  contributions: Contribution[];
};

type SensitivityResult = {
  sensitive: boolean;
  description: string;
};

export function evaluateDecision(decision: Decision): EvaluationResult {
  const errors: string[] = [];
  const invalidWeight = decision.criteria.some(
    (criterion) => !Number.isFinite(criterion.weight) || criterion.weight < 0,
  );
  if (invalidWeight) errors.push("评价维度权重必须是有限的非负数。");

  const enabledCriteria = decision.criteria.filter(
    (criterion) => Number.isFinite(criterion.weight) && criterion.weight > 0,
  );
  const feasibleOptions = decision.options.filter((option) =>
    decision.constraints.every((constraint) => constraint.evaluations[option.id] !== "infeasible"),
  );
  const weightTotal = enabledCriteria.reduce((sum, criterion) => sum + criterion.weight, 0);

  if (decision.options.length < 2) errors.push("至少添加两个方案后才能比较。");
  if (feasibleOptions.length < 2) errors.push("至少需要两个可行方案才能比较。");
  if (!Number.isFinite(weightTotal) || Math.abs(weightTotal - 1) > 0.001) {
    errors.push("评价维度权重需要合计 100%。");
  }
  if (enabledCriteria.length === 0) errors.push("至少保留一个评价维度。");

  const pendingConstraintOptionIds = decision.options
    .filter((option) =>
      decision.constraints.some(
        (constraint) => constraint.evaluations[option.id] === undefined || constraint.evaluations[option.id] === "unknown",
      ),
    )
    .map((option) => option.id);

  const baseRows: ScoredRow[] = feasibleOptions.map((option) => {
    const contributions: Contribution[] = enabledCriteria.map((criterion) => {
      const rawScore = decision.scores.find(
        (item) => item.optionId === option.id && item.criterionId === criterion.id,
      )?.value;
      const score = typeof rawScore === "number" && Number.isFinite(rawScore) ? rawScore : 0;
      // Tolerated weight rounding must use the same normalized scale as sensitivity.
      const normalizedWeight = Number.isFinite(weightTotal) && weightTotal > 0
        ? criterion.weight / weightTotal
        : 0;
      return {
        criterionId: criterion.id,
        criterionName: criterion.name,
        score,
        weightedContribution: score * normalizedWeight,
      };
    });
    return {
      optionId: option.id,
      utility: contributions.reduce((sum, item) => sum + item.weightedContribution, 0),
      contributions,
    };
  });

  const invalidScore = feasibleOptions.some((option) =>
    enabledCriteria.some((criterion) => {
      const score = decision.scores.find(
        (item) => item.optionId === option.id && item.criterionId === criterion.id,
      )?.value;
      return score === null || score === undefined || typeof score !== "number" || !Number.isFinite(score) || score < 1 || score > 10;
    }),
  );
  if (invalidScore) errors.push("请为每个可行方案的每个维度填写 1-10 分。");
  if (feasibleOptions.some((option) =>
    enabledCriteria.some((criterion) => {
      const score = decision.scores.find(
        (item) => item.optionId === option.id && item.criterionId === criterion.id,
      )?.value;
      return typeof score === "number" && !Number.isFinite(score);
    }),
  )) {
    errors.push("评分必须是有限的数字。");
  }

  const ready = errors.length === 0;
  const sorted = [...baseRows].sort((a, b) => b.utility - a.utility);
  const tiedFirstOptionIds = sorted.length > 1 && Math.abs(sorted[0]!.utility - sorted[1]!.utility) <= EPSILON
    ? sorted.filter((row) => Math.abs(row.utility - sorted[0]!.utility) <= EPSILON).map((row) => row.optionId)
    : [];
  const rankFor = (index: number): number => {
    if (index === 0) return 1;
    return Math.abs(sorted[index]!.utility - sorted[index - 1]!.utility) <= EPSILON
      ? rankFor(index - 1)
      : index + 1;
  };

  const rows: EvaluationRow[] = sorted.map((row, index) => {
    const alternative = sorted.find((candidate) => candidate.optionId !== row.optionId);
    const sortedContributions = [...row.contributions].sort((a, b) => b.weightedContribution - a.weightedContribution);
    const relativeContributions: RelativeContribution[] = alternative
      ? row.contributions.map((contribution) => {
        const alternativeContribution = alternative.contributions.find(
          (candidate) => candidate.criterionId === contribution.criterionId,
        );
        return {
          ...contribution,
          alternativeScore: alternativeContribution?.score ?? 0,
          weightedDifference: contribution.weightedContribution - (alternativeContribution?.weightedContribution ?? 0),
        };
      })
      : [];
    return {
      rank: rankFor(index),
      optionId: row.optionId,
      utility: round(row.utility),
      bestForegoneOptionId: alternative?.optionId,
      bestForegoneUtility: alternative ? round(alternative.utility) : undefined,
      netAdvantageOverNextBest: alternative ? round(row.utility - alternative.utility) : undefined,
      strengths: sortedContributions.slice(0, 2),
      weaknesses: sortedContributions.slice(-2).reverse(),
      relativeContributions,
    };
  });

  const baselineForDecisive = sorted[0];
  const secondBest = sorted.find((candidate) => candidate.optionId !== baselineForDecisive?.optionId);
  const decisiveCriteria = baselineForDecisive && secondBest
    ? baselineForDecisive.contributions
      .map((contribution) => {
        const alternative = secondBest.contributions.find((candidate) => candidate.criterionId === contribution.criterionId);
        return { name: contribution.criterionName, difference: Math.abs(contribution.weightedContribution - (alternative?.weightedContribution ?? 0)) };
      })
      .sort((a, b) => b.difference - a.difference)
      .slice(0, 2)
      .map((item) => item.name)
    : [];

  const notices: EvaluationResult["notices"] = [];
  if (decision.sunkCosts.some((cost) => !cost.recoverable)) {
    notices.push({ concept: "sunk", title: "识别到沉没成本", body: "已经发生且无法收回的投入不会改变未来方案得分。把它记录下来，是为了看见它，而不是继续被它绑住。" });
  }
  if (ready && rows.length > 1 && rows[0]?.bestForegoneOptionId) {
    notices.push({ concept: "opportunity", title: "看见机会成本", body: "选择一个方案，也意味着放弃当前最好的可行替代方案。机会成本是被放弃的价值，不是额外再扣一遍分。" });
  }
  if (decision.constraints.length > 0) {
    notices.push(pendingConstraintOptionIds.length > 0
      ? { concept: "constraint", title: "存在待核实约束", body: "部分方案的约束状态未知或尚未记录，因此它们仍参与条件排序；请在做决定前核实这些约束。" }
      : { concept: "constraint", title: "先处理稀缺约束", body: "预算、时间和地点等硬约束先决定哪些方案可行，再比较可行方案之间的取舍。" });
  }
  const advancedEnabled = Object.values(decision.advanced ?? {}).some(Boolean);
  if (advancedEnabled) {
    notices.push({ concept: "advanced", title: "高级模块尚未参与计算", body: "这些高级模块目前尚未实现，仅作为预留开关保存，未参与本次基础加权结果。" });
  }

  if (!ready) {
    return {
      calculationVersion: CALCULATION_VERSION,
      evaluatedRevision: decision.revision,
      ready: false,
      errors,
      rows: [],
      stability: "insufficient_data",
      decisiveCriteria: [],
      activeAdvancedModules: [],
      notices,
      stabilityDescription: "输入尚未完整，无法判断结论稳定性。",
      tiedFirstOptionIds: [],
      pendingConstraintOptionIds,
    };
  }

  const sensitivity = assessSensitivity(decision, feasibleOptions.map((option) => option.id), enabledCriteria, weightTotal);
  return {
    calculationVersion: CALCULATION_VERSION,
    evaluatedRevision: decision.revision,
    ready: true,
    errors,
    rows,
    stability: sensitivity.sensitive ? "sensitive" : "stable",
    decisiveCriteria,
    activeAdvancedModules: [],
    notices,
    stabilityDescription: sensitivity.description,
    tiedFirstOptionIds,
    pendingConstraintOptionIds,
  };
}

function assessSensitivity(
  decision: Decision,
  optionIds: UUID[],
  enabledCriteria: Criterion[],
  weightTotal: number,
): SensitivityResult {
  if (enabledCriteria.length < 2) {
    return { sensitive: false, description: "只有一个正权重维度，未执行维度间权重敏感性检查。" };
  }
  const baselineWeights = new Map(enabledCriteria.map((criterion) => [criterion.id, criterion.weight / weightTotal]));
  const baseline = evaluateWithWeights(decision, optionIds, baselineWeights);
  const baselineWinners = winnerIds(baseline);
  let checked = 0;

  for (const criterion of enabledCriteria) {
    const index = enabledCriteria.findIndex((item) => item.id === criterion.id);
    for (const target of [
      Math.min(1, criterion.weight / weightTotal + 0.05),
      Math.max(0, criterion.weight / weightTotal - 0.05),
    ]) {
      const changed = perturbWeights(enabledCriteria, baselineWeights, index, target);
      if (!changed) continue;
      checked += 1;
      if (!sameIds(winnerIds(evaluateWithWeights(decision, optionIds, changed)), baselineWinners)) {
        return {
          sensitive: true,
          description: "在每个正权重维度最多上下 5 个百分点、其余权重按比例缩放的检查范围内，第一名或并列关系发生了变化。",
        };
      }
    }
  }
  return {
    sensitive: false,
    description: checked > 0
      ? "在每个正权重维度最多上下 5 个百分点、其余权重按比例缩放的检查范围内，第一名及并列关系未改变。"
      : "没有可执行的权重扰动路径，未完成敏感性检查。",
  };
}

function perturbWeights(
  criteria: Criterion[],
  baseline: Map<UUID, number>,
  index: number,
  target: number,
): Map<UUID, number> | undefined {
  const current = baseline.get(criteria[index]!.id) ?? 0;
  const othersTotal = 1 - current;
  if (Math.abs(target - current) <= EPSILON || othersTotal <= EPSILON) return undefined;
  const scale = (1 - target) / othersTotal;
  const result = new Map(criteria.map((criterion, criterionIndex) => [
    criterion.id,
    criterionIndex === index ? target : (baseline.get(criterion.id) ?? 0) * scale,
  ]));
  const total = [...result.values()].reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return undefined;
  return new Map([...result.entries()].map(([id, weight]) => [id, Math.max(0, weight / total)]));
}

function evaluateWithWeights(decision: Decision, optionIds: UUID[], weights: Map<UUID, number>): ScoredRow[] {
  const included = new Set(optionIds);
  return decision.options
    .filter((option) => included.has(option.id))
    .map((option) => {
      const contributions: Contribution[] = decision.criteria
        .filter((criterion) => (weights.get(criterion.id) ?? 0) > 0)
        .map((criterion) => {
          const score = decision.scores.find((item) => item.optionId === option.id && item.criterionId === criterion.id)?.value ?? 0;
          const weight = weights.get(criterion.id) ?? 0;
          return { criterionId: criterion.id, criterionName: criterion.name, score, weightedContribution: score * weight };
        });
      return { optionId: option.id, utility: contributions.reduce((sum, item) => sum + item.weightedContribution, 0), contributions };
    })
    .sort((a, b) => b.utility - a.utility);
}

function winnerIds(rows: ScoredRow[]): UUID[] {
  const first = rows[0];
  return first ? rows.filter((row) => Math.abs(row.utility - first.utility) <= EPSILON).map((row) => row.optionId) : [];
}

function sameIds(left: UUID[], right: UUID[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}
