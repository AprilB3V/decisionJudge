import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDecision } from "../application/decisionService";
import { evaluateDecision } from "../domain/evaluation";
import type { Decision, EvaluationResult } from "../domain/types";
import { emptyWorkflow } from "../domain/workflow";
import { OptionsStep, ProblemStep, ResultPanel, ScoresStep, WeightsStep, type DecisionStepProps } from "./DecisionSteps";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mountStep(Component: ComponentType<DecisionStepProps>, decision: Decision, professional = true) {
  let current = { ...decision, advancedUiExpanded: professional };
  const render = () => root.render(createElement(Component, {
    draft: current,
    onUpdate: (change) => { current = { ...current, ...change }; render(); },
  }));
  await act(async () => render());
  return { decision: () => current, mode: async (value: boolean) => { current = { ...current, advancedUiExpanded: value }; await act(async () => render()); } };
}

async function enter(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function button(text: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(text));
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found;
}

function completedDecision() {
  const draft = createDecision("study-or-work");
  return { ...draft, scores: draft.scores.map((score) => ({ ...score, value: 7 })) };
}

describe("decision comparison steps", () => {
  it("offers only weight and note inputs by default and retains anchors when switching modes", async () => {
    const draft = createDecision("job-change");
    const state = await mountStep(WeightsStep, draft, false);
    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(container.textContent).not.toContain("摆幅赋权");
    expect(container.textContent).not.toContain("1 分代表");
    await enter(container.querySelector<HTMLInputElement>('input[aria-label="职业发展权重百分比"]')!, "50");
    await enter(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="职业发展备注"]')!, "我最在意成长");
    await click(button("按比例调整到 100%"));
    expect(state.decision().criteria.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1);
    const comparison = structuredClone(state.decision().criteria);
    await state.mode(true);
    expect(container.textContent).toContain("摆幅赋权");
    expect(state.decision().criteria).toEqual(comparison);
    await state.mode(false);
    expect(state.decision().criteria[0].lowAnchor).toBe(draft.criteria[0].lowAnchor);
    expect(state.decision().criteria[0].description).toBe("我最在意成长");
  });

  it("keeps scores and notes in simple mode without removing professional evidence metadata", async () => {
    const draft = createDecision("job-change");
    draft.scores[0] = { ...draft.scores[0], value: 7, evidence: "原备注", evidenceSource: "访谈", evidenceKind: "fact", evidenceConfidence: "high" };
    const state = await mountStep(ScoresStep, draft, false);
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('input[type="date"]')).toBeNull();
    await enter(container.querySelector<HTMLTextAreaElement>("textarea")!, "更新备注");
    await enter(container.querySelector<HTMLInputElement>('input[type="number"]')!, "8");
    expect(state.decision().scores[0]).toMatchObject({ value: 8, evidence: "更新备注", evidenceSource: "访谈", evidenceKind: "fact", evidenceConfidence: "high" });
    await state.mode(true);
    expect(container.querySelector("select")).not.toBeNull();
    await state.mode(false);
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("更新备注");
  });
  it("keeps a renamed constraint's identity, requires revalidation and never reuses removed evaluations", async () => {
    const draft = createDecision("study-or-work");
    draft.constraints = [
      { id: "budget", label: "预算", description: "", evaluations: { [draft.options[0]!.id]: "feasible" } },
      { id: "location", label: "地点", description: "", evaluations: { [draft.options[1]!.id]: "infeasible" } },
    ];
    const state = await mountStep(ProblemStep, draft);
    await enter(container.querySelector<HTMLInputElement>("#constraint-budget")!, "预算上限");
    expect(state.decision().constraints[0]).toMatchObject({ id: "budget", label: "预算上限", evaluations: {} });
    await click(container.querySelector<HTMLButtonElement>('[aria-label="删除约束 1"]')!);
    await click(button("添加约束"));
    expect(state.decision().constraints[0]!.id).toBe("location");
    expect(state.decision().constraints[0]!.evaluations).toEqual(draft.constraints[1]!.evaluations);
    expect(state.decision().constraints[1]!.id).not.toBe("budget");
    expect(state.decision().constraints[1]!.evaluations).toEqual({});
  });

  it("requires revalidation when a hard constraint's explanation changes", async () => {
    const draft = createDecision("study-or-work");
    draft.status = "decided";
    draft.chosenOptionId = draft.options[0]!.id;
    draft.constraints = [{ id: "budget", label: "预算", description: "仅购买费用", evaluations: Object.fromEntries(draft.options.map((option) => [option.id, "feasible" as const])) }];
    const state = await mountStep(ProblemStep, draft);
    await enter(container.querySelector<HTMLInputElement>('[aria-label="约束 1 说明"]')!, "包含维护费用");
    expect(state.decision().constraints[0]).toMatchObject({ id: "budget", description: "包含维护费用", evaluations: {} });
    expect(state.decision().chosenOptionId).toBeUndefined();
    expect(state.decision().status).toBe("draft");
  });

  it("upserts evidence before a score exists for a newly added criterion", async () => {
    const draft = createDecision("study-or-work");
    draft.criteria = [{ id: "new-criterion", name: "新维度", description: "", lowAnchor: "低", highAnchor: "高", weight: 1 }];
    draft.scores = [];
    const state = await mountStep(ScoresStep, draft);
    await enter(container.querySelector<HTMLTextAreaElement>(".dj-score-option textarea")!, "访谈记录支持这个判断");
    expect(state.decision().scores).toHaveLength(1);
    expect(state.decision().scores[0]).toMatchObject({ optionId: draft.options[0]!.id, criterionId: "new-criterion", value: null, evidence: "访谈记录支持这个判断" });
    await enter(container.querySelector<HTMLInputElement>(".dj-score-input-line input")!, "8");
    expect(state.decision().scores).toHaveLength(1);
    expect(state.decision().scores[0]!.value).toBe(8);
    expect(state.decision().scores[0]!.evidence).toBe("访谈记录支持这个判断");
  });

  it("clears a current choice when a new hard constraint makes its feasibility unknown", async () => {
    const draft = createDecision("study-or-work");
    draft.status = "decided";
    draft.chosenOptionId = draft.options[0]!.id;
    const state = await mountStep(ProblemStep, draft);
    await click(button("添加约束"));
    expect(state.decision().chosenOptionId).toBeUndefined();
    expect(state.decision().status).toBe("draft");
  });

  it("clears removed option references and an invalid chosen option while preserving verification content", async () => {
    const draft = createDecision("study-or-work");
    const optionId = draft.options[0]!.id;
    draft.status = "decided";
    draft.chosenOptionId = optionId;
    draft.workflow = { ...emptyWorkflow(), verificationTasks: [{ id: "task", optionId, criterionId: draft.criteria[0]!.id, hypothesis: "关键事实", decisionImpact: "影响决定", method: "访谈", source: "记录", costAmount: 0, costUnit: "CNY", dueDate: "", status: "open", finding: "", updatedAt: "2026-01-01T00:00:00Z" }] };
    draft.constraints = [{ id: "constraint", label: "底线", description: "", evaluations: { [optionId]: "feasible" } }];
    const state = await mountStep(OptionsStep, draft);
    await click(container.querySelector<HTMLButtonElement>(`.dj-option-card button`) !);
    expect(state.decision().options).toHaveLength(2);
    expect(state.decision().chosenOptionId).toBeUndefined();
    expect(state.decision().status).toBe("draft");
    expect(state.decision().scores.some((score) => score.optionId === optionId)).toBe(false);
    expect(state.decision().constraints[0]!.evaluations[optionId]).toBeUndefined();
    expect(state.decision().workflow!.verificationTasks[0]).toMatchObject({ optionId: undefined, criterionId: draft.criteria[0]!.id, hypothesis: "关键事实", method: "访谈", costAmount: 0 });
    expect(container.querySelector<HTMLButtonElement>(`.dj-option-card button`)!.disabled).toBe(true);
  });

  it("clears a removed criterion's scores and verification reference without deleting the task", async () => {
    const draft = createDecision("study-or-work");
    const criterionId = draft.criteria[0]!.id;
    draft.workflow = { ...emptyWorkflow(), verificationTasks: [{ id: "task", optionId: draft.options[0]!.id, criterionId, hypothesis: "待验证", decisionImpact: "影响选择", method: "", source: "", costAmount: null, costUnit: "CNY", dueDate: "", status: "open", finding: "", updatedAt: "2026-01-01T00:00:00Z" }] };
    const state = await mountStep(WeightsStep, draft);
    await click(button("删除维度"));
    expect(state.decision().criteria.some((criterion) => criterion.id === criterionId)).toBe(false);
    expect(state.decision().scores.some((score) => score.criterionId === criterionId)).toBe(false);
    expect(state.decision().workflow!.verificationTasks[0]).toMatchObject({ criterionId: undefined, optionId: draft.options[0]!.id, hypothesis: "待验证" });
  });

  it("does not infer ties from rounded scores and renders genuine shared ranks", async () => {
    const draft = completedDecision();
    const result = evaluateDecision(draft);
    const distinct: EvaluationResult = { ...result, tiedFirstOptionIds: [], rows: result.rows.map((row, index) => ({ ...row, rank: index + 1, utility: 7 })) };
    await act(async () => root.render(createElement(ResultPanel, { draft, result: distinct, onSaveSnapshot: vi.fn().mockResolvedValue(undefined) })));
    expect(container.querySelectorAll(".dj-recommended")).toHaveLength(1);
    expect(container.textContent).not.toContain("当前存在并列第一");
    await act(async () => root.render(createElement(ResultPanel, { draft, result, onSaveSnapshot: vi.fn().mockResolvedValue(undefined) })));
    expect(container.querySelectorAll(".dj-recommended")).toHaveLength(3);
    expect(container.textContent).toContain("当前存在并列第一");
    expect(container.querySelectorAll(".dj-contribution-row")).toHaveLength(draft.criteria.length);
  });

  it("excludes unknown constraints from snapshot selection and reports a rejected save only as failure", async () => {
    const draft = completedDecision();
    draft.constraints = [{ id: "c", label: "需核实", description: "", evaluations: { [draft.options[0]!.id]: "unknown", [draft.options[1]!.id]: "feasible", [draft.options[2]!.id]: "feasible" } }];
    const save = vi.fn().mockRejectedValue(new Error("存储空间不足"));
    await act(async () => root.render(createElement(ResultPanel, { draft, result: evaluateDecision(draft), onSaveSnapshot: save })));
    const selectable = [...container.querySelectorAll<HTMLOptionElement>(".dj-snapshot option")].map((option) => option.value);
    expect(selectable).not.toContain(draft.options[0]!.id);
    await click(button("确认并保存快照"));
    expect(save).toHaveBeenCalledWith(draft.options[1]!.id);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("存储空间不足");
    expect(container.textContent).not.toContain("决策快照已保存");
  });

  it("clears a saved-snapshot message when comparison input becomes a new draft", async () => {
    const draft = completedDecision();
    draft.status = "decided";
    const save = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(createElement(ResultPanel, { draft, result: evaluateDecision(draft), onSaveSnapshot: save })));
    await click(button("再次保存快照"));
    expect(container.textContent).toContain("决策快照已保存");
    const edited: Decision = { ...draft, status: "draft", chosenOptionId: undefined, title: "改过的比较", updatedAt: "2099-01-01T00:00:00Z" };
    await act(async () => root.render(createElement(ResultPanel, { draft: edited, result: evaluateDecision(edited), onSaveSnapshot: save })));
    expect(container.textContent).not.toContain("决策快照已保存");
    expect(button("确认并保存快照")).toBeDefined();
  });

  it("accepts zero swing points and explains that risk settings do not affect the ranking", async () => {
    const draft = completedDecision();
    draft.advanced.riskEnabled = true;
    const state = await mountStep(WeightsStep, draft);
    const inputs = [...container.querySelectorAll<HTMLInputElement>(".dj-swing-grid input")];
    for (let index = 0; index < inputs.length; index++) await enter(inputs[index]!, index === 1 ? "100" : "0");
    await click(button("应用并归一化"));
    expect(state.decision().criteria[0]!.weight).toBe(0);
    expect(state.decision().criteria[1]!.weight).toBe(1);
    expect(container.textContent).toContain("风险偏好");
    expect(container.textContent).toContain("未参与基础排名");
    expect(container.querySelector('button[aria-pressed]')).toBeNull();
    const before = evaluateDecision({ ...state.decision(), advanced: { ...draft.advanced, riskEnabled: false } });
    expect(evaluateDecision(state.decision()).rows).toEqual(before.rows);
  });
});
