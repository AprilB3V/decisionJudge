import { describe, expect, it } from "vitest";
import { addDecisionOption, applyDecisionChange, createDecision, createDecisionFromPreset, createPreset, createSnapshot, exportPayload, removeDecisionOption } from "./decisionService";
import { CALCULATION_VERSION } from "../domain/evaluation";
import type { Decision } from "../domain/types";
import { emptyWorkflow } from "../domain/workflow";

const completeDecision = (): Decision => {
  const decision = createDecision("study-or-work");
  return { ...decision, scores: decision.scores.map((score) => ({ ...score, value: 7 })) };
};

describe("decision option operations", () => {
  it("creates one empty score for every criterion when adding an option", () => {
    const decision = createDecision("study-or-work");
    const updated = addDecisionOption(decision, "new-option");

    expect(updated.options.at(-1)?.id).toBe("new-option");
    expect(updated.scores.filter((score) => score.optionId === "new-option")).toHaveLength(decision.criteria.length);
    expect(updated.scores.filter((score) => score.optionId === "new-option").every((score) => score.value === null)).toBe(true);
  });

  it("cleans scores, constraint references and chosen state when deleting an option", () => {
    const decision = addDecisionOption(createDecision("study-or-work"), "new-option");
    const decided = {
      ...decision,
      status: "decided" as const,
      chosenOptionId: "new-option",
      constraints: [{ id: "constraint", label: "底线", description: "", evaluations: { "new-option": "infeasible" as const } }],
    };
    const updated = removeDecisionOption(decided, "new-option");

    expect(updated.options.some((option) => option.id === "new-option")).toBe(false);
    expect(updated.scores.some((score) => score.optionId === "new-option")).toBe(false);
    expect(updated.constraints[0]?.evaluations["new-option"]).toBeUndefined();
    expect(updated.chosenOptionId).toBeUndefined();
    expect(updated.status).toBe("draft");
  });

  it("keeps at least two options", () => {
    const decision = createDecision("job-change");
    expect(removeDecisionOption(decision, decision.options[0]!.id)).toBe(decision);
  });

  it("creates an empty decision from the blank template", () => {
    const decision = createDecision("blank");

    expect(decision.options).toHaveLength(0);
    expect(decision.criteria).toHaveLength(0);
    expect(decision.scores).toHaveLength(0);
    expect(decision.templateName).toBe("空白模板");
  });

  it("stores only reusable structure in a preset", () => {
    const decision = createDecision("study-or-work");
    const preset = createPreset(decision, "职业选择框架", "用于比较下一份工作");

    expect(preset.name).toBe("职业选择框架");
    expect(preset.description).toBe("用于比较下一份工作");
    expect(preset.criteria[0]).not.toHaveProperty("id");
    expect(preset.options[0]).not.toHaveProperty("id");
    expect(preset).not.toHaveProperty("scores");
  });

  it("rebuilds ids and score cells when starting from a preset", () => {
    const source = createDecision("study-or-work");
    const preset = createPreset(source, "职业选择框架");
    const decision = createDecisionFromPreset(preset);

    expect(decision.options.map((option) => option.id)).not.toEqual(source.options.map((option) => option.id));
    expect(decision.criteria.map((criterion) => criterion.id)).not.toEqual(source.criteria.map((criterion) => criterion.id));
    expect(decision.scores).toHaveLength(decision.options.length * decision.criteria.length);
    expect(decision.scores.every((score) => score.value === null && score.evidence === "")).toBe(true);
  });

  it("includes presets in portable exports", () => {
    const preset = createPreset(createDecision("blank"), "空白决策框架");
    const payload = JSON.parse(exportPayload([], [], [preset])) as { presets?: unknown[] };

    expect(payload.presets).toHaveLength(1);
  });
});

describe("snapshot and comparison revisions", () => {
  it("aligns the embedded decision, evaluation, source revision and current calculation version", () => {
    const decision = { ...completeDecision(), revision: 18, calculationVersion: "weighted-utility-v1" };
    const snapshot = createSnapshot(decision, decision.options[0]!.id);
    expect(snapshot.sourceRevision).toBe(19);
    expect(snapshot.decision.revision).toBe(snapshot.sourceRevision);
    expect(snapshot.result.evaluatedRevision).toBe(snapshot.sourceRevision);
    expect(snapshot.calculationVersion).toBe(CALCULATION_VERSION);
    expect(snapshot.decision.calculationVersion).toBe(snapshot.calculationVersion);
    expect(snapshot.result.calculationVersion).toBe(snapshot.calculationVersion);
    expect(snapshot.decision.status).toBe("decided");
    expect(decision).toMatchObject({ revision: 18, status: "draft", calculationVersion: "weighted-utility-v1" });
  });

  it("takes the latest supplied input and detaches it from later nested edits", () => {
    const decision = completeDecision();
    const first = decision.options[0]!.id;
    const updated = applyDecisionChange(decision, {
      title: "刚刚输入的标题",
      scores: decision.scores.map((score) => ({ ...score, value: score.optionId === first ? 9 : 6, evidence: "刚刚核实的证据" })),
    });
    const snapshot = createSnapshot(updated, first);
    expect(snapshot.decision.title).toBe("刚刚输入的标题");
    expect(snapshot.result.rows[0]).toMatchObject({ optionId: first, utility: 9 });
    updated.scores[0]!.evidence = "事后改变";
    updated.options[0]!.name = "事后名称";
    expect(snapshot.decision.scores[0]!.evidence).toBe("刚刚核实的证据");
    expect(snapshot.decision.options[0]!.name).not.toBe("事后名称");
  });

  it.each(["unknown", undefined] as const)("rejects selecting a constraint whose status is %s", (status) => {
    const decision = completeDecision();
    const [first, second, third] = decision.options;
    decision.constraints = [{ id: "boundary", label: "必须满足", description: "", evaluations: { [second!.id]: "feasible", [third!.id]: "feasible", ...(status ? { [first!.id]: status } : {}) } }];
    expect(() => createSnapshot(decision, first!.id)).toThrow("请先确认所选方案满足每一条底线");
    expect(createSnapshot(decision, second!.id).chosenOptionId).toBe(second!.id);
  });

  it("rejects excluded or nonexistent choices and unlabeled hard constraints", () => {
    const decision = completeDecision();
    const [first, second, third] = decision.options;
    decision.constraints = [{ id: "boundary", label: "预算", description: "", evaluations: { [first!.id]: "infeasible", [second!.id]: "feasible", [third!.id]: "feasible" } }];
    expect(() => createSnapshot(decision, first!.id)).toThrow("请选择当前排名中的方案");
    expect(() => createSnapshot(decision, "missing-option")).toThrow("请选择当前排名中的方案");
    decision.constraints[0]!.label = " ";
    expect(() => createSnapshot(decision, second!.id)).toThrow("请先确认所选方案满足每一条底线");
  });

  it.each(["title", "objective", "decisionDate", "options", "criteria", "scores", "constraints"] as const)("returns a decided comparison to draft when %s changes", (key) => {
    const decision = completeDecision();
    decision.status = "decided";
    decision.chosenOptionId = decision.options[0]!.id;
    const next = applyDecisionChange(decision, { [key]: decision[key] });
    expect(next.status).toBe("draft");
    expect(next.chosenOptionId).toBeUndefined();
    expect(decision.status).toBe("decided");
  });

  it("preserves the choice for follow-through records and detaches deleted verification links", () => {
    const decision = completeDecision();
    decision.status = "decided";
    decision.chosenOptionId = decision.options[0]!.id;
    decision.workflow = { ...emptyWorkflow(), verificationTasks: [{ id: "task", optionId: decision.options[2]!.id, criterionId: decision.criteria[0]!.id, hypothesis: "查证条件", decisionImpact: "改变排序", method: "访谈", source: "笔记", costAmount: 0, costUnit: "CNY", dueDate: "", status: "open", finding: "保留的事实", updatedAt: "2026-01-01T00:00:00Z" }] };
    const followed = applyDecisionChange(decision, { workflow: structuredClone(decision.workflow) });
    expect(followed.status).toBe("decided");
    expect(followed.chosenOptionId).toBe(decision.chosenOptionId);
    const removed = applyDecisionChange(decision, { options: decision.options.slice(0, 2), criteria: decision.criteria.slice(1) });
    expect(removed.workflow!.verificationTasks).toHaveLength(1);
    expect(removed.workflow!.verificationTasks[0]).toMatchObject({ optionId: undefined, criterionId: undefined, hypothesis: "查证条件", finding: "保留的事实" });
    expect(decision.workflow.verificationTasks[0]!.optionId).toBe(decision.options[2]!.id);
  });

  it("invalidates the prior confirmation when adding or removing an unchosen option", () => {
    const decision = completeDecision();
    decision.status = "decided";
    decision.chosenOptionId = decision.options[0]!.id;
    const added = addDecisionOption(decision, "new-option");
    expect(added.status).toBe("draft");
    expect(added.chosenOptionId).toBeUndefined();
    const removed = removeDecisionOption(decision, decision.options[2]!.id);
    expect(removed.status).toBe("draft");
    expect(removed.chosenOptionId).toBeUndefined();
  });

  it("cannot erase sealed predictions by removing the whole workflow", () => {
    const decision = completeDecision();
    decision.workflow = { ...emptyWorkflow(), predictions: [{ id: "prediction", statement: "完成项目", probability: 0.6, outcome: null, dueDate: "2099-12-31", evidence: "计划与资源估计", basis: "计划与资源估计", createdAt: "2026-01-01T00:00:00Z", sealedAt: "2026-01-02T00:00:00Z" }] };
    expect(() => applyDecisionChange(decision, { workflow: undefined })).toThrow("已封存预测不能移除");
    expect(() => applyDecisionChange(decision, { workflow: emptyWorkflow() })).toThrow("已封存预测不能移除");
    expect(decision.workflow.predictions).toHaveLength(1);
  });

  it("updates the edit timestamp without pretending the unsaved revision has been persisted", () => {
    const decision = { ...completeDecision(), updatedAt: "2000-01-01T00:00:00Z", revision: 21 };
    const next = applyDecisionChange(decision, { title: "新的输入" });
    expect(next.updatedAt).not.toBe(decision.updatedAt);
    expect(Number.isFinite(Date.parse(next.updatedAt))).toBe(true);
    expect(next.revision).toBe(21);
    expect(decision.title).not.toBe(next.title);
  });
});
