import { describe, expect, it } from "vitest";
import { addDecisionOption, createDecision, createDecisionFromPreset, createPreset, exportPayload, removeDecisionOption } from "./decisionService";

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
