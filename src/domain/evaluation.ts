import type { Decision, EvaluationResult, Contribution, EvaluationRow } from "./types";

export const CALCULATION_VERSION = "weighted-utility-v1";

const round = (value: number) => Math.round(value * 100) / 100;

export function evaluateDecision(decision: Decision): EvaluationResult {
  const errors: string[] = [];
  const enabledCriteria = decision.criteria.filter((criterion) => criterion.weight > 0);
  const feasibleOptions = decision.options.filter((option) =>
    decision.constraints.every((constraint) => constraint.evaluations[option.id] !== "infeasible"),
  );

  if (decision.options.length < 2) errors.push("至少添加两个方案后才能比较。");
  if (feasibleOptions.length < 2) errors.push("至少需要两个可行方案才能比较。");
  const weightTotal = enabledCriteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (Math.abs(weightTotal - 1) > 0.001) errors.push("评价维度权重需要合计 100%。");
  if (enabledCriteria.length === 0) errors.push("至少保留一个评价维度。");

  const activeAdvancedModules = Object.entries(decision.advanced)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
  const baseRows = feasibleOptions.map((option) => {
    const contributions: Contribution[] = enabledCriteria.map((criterion) => {
      const score = decision.scores.find((item) => item.optionId === option.id && item.criterionId === criterion.id)?.value;
      return { criterionId: criterion.id, criterionName: criterion.name, score: score ?? 0, weightedContribution: (score ?? 0) * criterion.weight };
    });
    return { optionId: option.id, utility: contributions.reduce((sum, item) => sum + item.weightedContribution, 0), contributions };
  });

  if (baseRows.some((row) => row.contributions.some((item) => item.score < 1 || item.score > 10))) {
    errors.push("请为每个可行方案的每个维度填写 1-10 分。");
  }
  const sorted = [...baseRows].sort((a, b) => b.utility - a.utility);
  const rows: EvaluationRow[] = sorted.map((row, index) => {
    const alternative = sorted.find((candidate) => candidate.optionId !== row.optionId);
    const sortedContributions = [...row.contributions].sort((a, b) => b.weightedContribution - a.weightedContribution);
    return {
      rank: index + 1,
      optionId: row.optionId,
      utility: round(row.utility),
      bestForegoneOptionId: alternative?.optionId,
      bestForegoneUtility: alternative ? round(alternative.utility) : undefined,
      netAdvantageOverNextBest: alternative ? round(row.utility - alternative.utility) : undefined,
      strengths: sortedContributions.slice(0, 2),
      weaknesses: sortedContributions.slice(-2).reverse(),
    };
  });

  const stability = errors.length > 0 ? "insufficient_data" : isSensitive(decision, feasibleOptions.map((option) => option.id)) ? "sensitive" : "stable";
  const decisiveCriteria = enabledCriteria
    .map((criterion) => ({ criterion, spread: Math.max(...feasibleOptions.map((option) => decision.scores.find((score) => score.optionId === option.id && score.criterionId === criterion.id)?.value ?? 0)) - Math.min(...feasibleOptions.map((option) => decision.scores.find((score) => score.optionId === option.id && score.criterionId === criterion.id)?.value ?? 0)) }))
    .sort((a, b) => b.criterion.weight * b.spread - a.criterion.weight * a.spread)
    .slice(0, 2)
    .map(({ criterion }) => criterion.name);

  const notices: EvaluationResult["notices"] = [];
  if (decision.sunkCosts.some((cost) => !cost.recoverable)) notices.push({ concept: "sunk", title: "识别到沉没成本", body: "已经发生且无法收回的投入不会改变未来方案得分。把它记录下来，是为了看见它，而不是继续被它绑住。" });
  if (rows.length > 1 && rows[0]?.bestForegoneOptionId) notices.push({ concept: "opportunity", title: "看见机会成本", body: "选择一个方案，也意味着放弃当前最好的可行替代方案。机会成本是被放弃的价值，不是额外再扣一遍分。" });
  if (decision.constraints.length > 0) notices.push({ concept: "constraint", title: "先处理稀缺约束", body: "预算、时间和地点等硬约束先决定哪些方案可行，再比较可行方案之间的取舍。" });
  if (activeAdvancedModules.length > 0) notices.push({ concept: "advanced", title: "高级参数生效中", body: "结果包含你启用的专业模块。折叠高级界面不会关闭这些参数。" });

  return { calculationVersion: CALCULATION_VERSION, evaluatedRevision: decision.revision, ready: errors.length === 0, errors, rows, stability, decisiveCriteria, activeAdvancedModules, notices };
}

function isSensitive(decision: Decision, optionIds: string[]) {
  const enabled = decision.criteria.filter((criterion) => criterion.weight > 0);
  if (enabled.length < 2 || optionIds.length < 2) return false;
  const baseline = evaluateWithWeights(decision, enabled.map((criterion) => criterion.weight));
  const winner = baseline[0]?.optionId;
  return enabled.some((criterion, index) => {
    const delta = Math.min(0.05, criterion.weight * 0.8);
    const changed = enabled.map((item, itemIndex) => itemIndex === index ? item.weight + delta : item.weight - delta / (enabled.length - 1));
    return evaluateWithWeights(decision, changed)[0]?.optionId !== winner;
  });
}

function evaluateWithWeights(decision: Decision, weights: number[]) {
  return decision.options
    .filter((option) => decision.constraints.every((constraint) => constraint.evaluations[option.id] !== "infeasible"))
    .map((option) => ({ optionId: option.id, utility: decision.criteria.reduce((sum, criterion, index) => sum + (decision.scores.find((score) => score.optionId === option.id && score.criterionId === criterion.id)?.value ?? 0) * (weights[index] ?? 0), 0) }))
    .sort((a, b) => b.utility - a.utility);
}
