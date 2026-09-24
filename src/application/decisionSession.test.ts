import { afterEach, describe, expect, it, vi } from "vitest";
import { createDecision, exportPayload } from "./decisionService";
import { DecisionSession } from "./decisionSession";
import { parseBackup } from "./backup";
import { appendReview, emptyWorkflow, localDate, sealPrediction, type DecisionWorkflow } from "../domain/workflow";
import type { Decision } from "../domain/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

function recoveryWorkflow(): DecisionWorkflow {
  const timestamp = new Date().toISOString();
  const workflow = appendReview({
    ...emptyWorkflow(),
    predictions: [sealPrediction({ id: "rescue-prediction", statement: "明天前收到结果", probability: 0.7,
      outcome: null, dueDate: "2026-09-23", evidence: "", basis: "对方承诺", createdAt: timestamp }, timestamp)],
  }, { id: "rescue-review", date: localDate(), judgment: "依据当前信息继续", execution: "已经联系", externalChange: "", nextStep: "等待结果" }, timestamp);
  return { ...workflow, reviewDraft: { id: "rescue-review-draft", date: localDate(), judgment: "未写完的复盘", execution: "", externalChange: "", nextStep: "" } };
}

describe("local edit session", () => {
  it("drains new edits after an in-flight save without losing input or reusing a revision", async () => {
    const firstWrite = deferred<Decision>();
    const save = vi.fn().mockImplementationOnce(() => firstWrite.promise).mockImplementation(async (decision) => decision);
    const session = new DecisionSession(createDecision("job-change"), { save, snapshot: vi.fn() });
    session.update({ title: "第一段输入" });
    const flushing = session.flush();
    await Promise.resolve();
    const first = save.mock.calls[0]![0] as Decision;
    session.update({ title: "输入仍在继续" });
    expect(session.flush()).toBe(flushing);
    firstWrite.resolve(first);
    await flushing;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![1]).toBe(first.revision);
    expect(session.getState().draft.title).toBe("输入仍在继续");
    expect(session.getState().draft.revision).toBe(3);
    expect(session.getState().dirty).toBe(false);
  });

  it("retains unsaved data on conflict and allows a deliberate retry", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("revision-conflict")).mockImplementation(async (decision) => decision);
    const session = new DecisionSession(createDecision("job-change"), { save, snapshot: vi.fn() });
    session.update({ title: "保留的草稿" });
    await expect(session.flush()).rejects.toThrow("revision-conflict");
    expect(session.getState()).toMatchObject({ dirty: true, saving: false, draft: { title: "保留的草稿", revision: 1 } });
    await session.flush();
    expect(session.getState().dirty).toBe(false);
  });

  it("flushes edits before an atomic snapshot and prevents concurrent edits during confirmation", async () => {
    const decision = createDecision("job-change");
    decision.scores.forEach((score) => { score.value = 7; });
    const write = deferred<void>();
    const snapshot = vi.fn().mockImplementation(() => write.promise);
    const session = new DecisionSession(decision, { save: async (d) => d, snapshot });
    session.update({ title: "准备确认" });
    const confirming = session.confirm(decision.options[0]!.id);
    expect(session.update({ title: "不应覆盖快照" })).toBe(false);
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledOnce());
    expect(snapshot.mock.calls[0]![1]).toBe(2);
    write.resolve();
    const saved = await confirming;
    expect(saved.sourceRevision).toBe(3);
    expect(saved.result.evaluatedRevision).toBe(3);
    expect(session.getState()).toMatchObject({ confirming: false, dirty: false, draft: { title: "准备确认", status: "decided", revision: 3 } });
  });

  it("does not report a failed snapshot as confirmed", async () => {
    const decision = createDecision("job-change");
    decision.scores.forEach((score) => { score.value = 7; });
    const session = new DecisionSession(decision, { save: async (d) => d, snapshot: async () => { throw new Error("配额不足"); } });
    await expect(session.confirm(decision.options[0]!.id)).rejects.toThrow("配额不足");
    expect(session.getState()).toMatchObject({ confirming: false, error: "配额不足", draft: { status: "draft", revision: 1 } });
  });

  it("exports a restorable rescue draft after workflow edits cannot be saved", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:00:00"));
    const decision = createDecision("job-change");
    const session = new DecisionSession(decision, { save: async () => { throw new Error("配额不足"); }, snapshot: vi.fn() });
    vi.setSystemTime(new Date("2026-09-22T12:00:00"));
    const workflow = recoveryWorkflow();
    expect(session.update({ workflow })).toBe(true);
    await expect(session.flush()).rejects.toThrow("配额不足");
    const unsaved = session.getState().draft;
    const rescued = parseBackup(exportPayload([unsaved], [])).decisions[0]!;
    expect(rescued).toEqual(unsaved);
    expect(rescued.workflow).toEqual(workflow);
    expect(rescued.workflow?.predictions[0]?.sealedAt).toBe(new Date().toISOString());
    expect(rescued.workflow?.reviewDraft?.judgment).toBe("未写完的复盘");
  });

  it("preserves restorable newer workflow timestamps when an older write finishes first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:00:00"));
    const firstWrite = deferred<Decision>();
    const save = vi.fn().mockImplementationOnce(() => firstWrite.promise).mockRejectedValueOnce(new Error("后续写入失败"));
    const session = new DecisionSession(createDecision("job-change"), { save, snapshot: vi.fn() });
    session.update({ title: "正在保存早期输入" });
    const flushing = session.flush();
    await Promise.resolve();
    const first = save.mock.calls[0]![0] as Decision;
    vi.setSystemTime(new Date("2026-09-22T12:00:00"));
    const workflow = recoveryWorkflow();
    expect(session.update({ workflow })).toBe(true);
    firstWrite.resolve(first);
    await expect(flushing).rejects.toThrow("后续写入失败");
    const latest = session.getState().draft;
    expect(latest.updatedAt).toBe(new Date().toISOString());
    expect(latest.revision).toBe(first.revision);
    expect(session.getState().dirty).toBe(true);
    expect(parseBackup(exportPayload([latest], [])).decisions[0]!.workflow).toEqual(workflow);
  });
});
