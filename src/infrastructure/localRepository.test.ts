import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDecision, createPreset, createSnapshot, updateRevision } from "../application/decisionService";
import { emptyWorkflow, sealPrediction, settlePrediction } from "../domain/workflow";
import {
  db, deleteDecision, getDecision, listDecisions, listPresets, listSnapshots,
  replaceAll, saveDecision, savePreset, saveSnapshot,
} from "./localRepository";

function readyDecision() {
  const decision = createDecision("job-change");
  return { ...decision, scores: decision.scores.map((score) => ({ ...score, value: 7 })) };
}

function protectedDecision() {
  const decision = readyDecision();
  decision.workflow = {
    ...emptyWorkflow(),
    predictions: [{
      id: "sealed-prediction", statement: "会完成约定任务", probability: 0.7, outcome: null,
      dueDate: "2099-01-01", evidence: "", basis: "已完成相关训练", createdAt: "2020-01-01T00:00:00.000Z",
      sealedAt: "2020-01-02T00:00:00.000Z",
    }],
    reviews: [{
      id: "sealed-review", date: "2020-01-03", judgment: "保留原始判断", execution: "已进行",
      externalChange: "", nextStep: "继续验证", createdAt: "2020-01-03T00:00:00.000Z",
    }],
  };
  return decision;
}

beforeEach(async () => {
  await db.transaction("rw", db.decisions, db.snapshots, db.presets, async () => {
    await db.decisions.clear();
    await db.snapshots.clear();
    await db.presets.clear();
  });
});

afterAll(async () => { await db.delete(); });

describe("transactional local decision writes", () => {
  it("allows exactly one of two writers using the same expected revision", async () => {
    const decision = readyDecision();
    await saveDecision(decision);
    const left = updateRevision({ ...decision, title: "first writer" });
    const right = updateRevision({ ...decision, title: "second writer" });
    const results = await Promise.allSettled([
      saveDecision(left, decision.revision), saveDecision(right, decision.revision),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toBe("revision-conflict");
    const winner = results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<typeof decision>;
    expect(await getDecision(decision.id)).toEqual(winner.value);
  });

  it("does not overwrite an existing decision through the creation path", async () => {
    const decision = readyDecision();
    await saveDecision(decision);
    await expect(saveDecision({ ...decision, title: "unconditional overwrite" })).rejects.toThrow("revision-conflict");
    expect(await getDecision(decision.id)).toEqual(decision);
  });

  it("does not resurrect a deleted decision from a stale writer or snapshot", async () => {
    const decision = readyDecision();
    await saveDecision(decision);
    const snapshot = createSnapshot(decision, decision.options[0]!.id);
    await deleteDecision(decision.id, false);
    await expect(saveDecision(updateRevision(decision), decision.revision)).rejects.toThrow("revision-conflict");
    await expect(saveSnapshot(snapshot, decision.revision)).rejects.toThrow("revision-conflict");
    expect(await getDecision(decision.id)).toBeUndefined();
    expect(await listSnapshots()).toEqual([]);
  });

  it("requires the next revision to advance exactly once", async () => {
    const decision = readyDecision();
    await saveDecision(decision);
    await expect(saveDecision(decision, decision.revision)).rejects.toThrow("revision-conflict");
    await expect(saveDecision({ ...decision, revision: decision.revision + 2 }, decision.revision)).rejects.toThrow("revision-conflict");
    expect((await getDecision(decision.id))?.revision).toBe(decision.revision);
  });

  it("rejects invalid initial workflow data before it reaches storage", async () => {
    const decision = readyDecision();
    decision.workflow = { ...emptyWorkflow(), investmentBoundary: { amount: -1, hours: null } };
    await expect(saveDecision(decision)).rejects.toThrow("金额边界");
    expect(await listDecisions()).toEqual([]);
  });

  it("rejects removing a whole workflow that contains sealed forecasts and appended reviews", async () => {
    const decision = protectedDecision();
    await saveDecision(decision);
    await expect(saveDecision(updateRevision({ ...decision, workflow: undefined }), decision.revision)).rejects.toThrow("已封存预测不能移除");
    await expect(saveDecision(updateRevision({
      ...decision, workflow: { ...decision.workflow!, reviews: [] },
    }), decision.revision)).rejects.toThrow("已追加的复盘记录不能修改");
    expect(await getDecision(decision.id)).toEqual(decision);
  });

  it("replays a sealed and settled forecast when the seal write failed earlier", async () => {
    const decision = readyDecision();
    const draftPrediction = {
      id: "replayed-prediction", statement: "会完成约定任务", probability: 0.7, outcome: null,
      dueDate: "2026-09-20", evidence: "对方承诺", createdAt: "2026-09-01T12:00:00.000Z",
    };
    decision.workflow = { ...emptyWorkflow(), predictions: [draftPrediction] };
    await saveDecision(decision);

    const sealed = sealPrediction(draftPrediction, "2026-09-10T12:00:00.000Z");
    const settled = settlePrediction(sealed, true, "观察记录", "2026-09-22T12:00:00.000Z");
    const final = updateRevision({
      ...decision,
      workflow: { ...decision.workflow, predictions: [settled] },
    });
    await expect(saveDecision(final, decision.revision)).resolves.toEqual(final);
    expect(await getDecision(decision.id)).toEqual(final);
  });
});

describe("atomic snapshots", () => {
  it("saves the decided revision and its snapshot together", async () => {
    const decision = readyDecision();
    await saveDecision(decision);
    const snapshot = createSnapshot(decision, decision.options[0]!.id);
    await saveSnapshot(snapshot, decision.revision);
    expect(await getDecision(decision.id)).toEqual(snapshot.decision);
    expect(await listSnapshots(decision.id)).toEqual([snapshot]);
  });

  it("rolls back the decision update when the snapshot ID already exists", async () => {
    const decision = readyDecision();
    await saveDecision(decision);
    const original = createSnapshot(decision, decision.options[0]!.id);
    await saveSnapshot(original, decision.revision);
    const duplicate = createSnapshot(original.decision, decision.options[1]!.id);
    duplicate.id = original.id;
    await expect(saveSnapshot(duplicate, original.decision.revision)).rejects.toThrow();
    expect(await getDecision(decision.id)).toEqual(original.decision);
    expect(await listSnapshots(decision.id)).toEqual([original]);
  });

  it("serializes an autosave racing with confirmation so neither can overwrite the other", async () => {
    const decision = readyDecision();
    await saveDecision(decision);
    const changed = updateRevision({ ...decision, title: "concurrent edit" });
    const snapshot = createSnapshot(decision, decision.options[0]!.id);
    const [save, confirmation] = await Promise.allSettled([
      saveDecision(changed, decision.revision), saveSnapshot(snapshot, decision.revision),
    ]);
    expect([save, confirmation].filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const persisted = await getDecision(decision.id);
    expect(persisted).toEqual(save.status === "fulfilled" ? changed : snapshot.decision);
    expect(await listSnapshots(decision.id)).toEqual(confirmation.status === "fulfilled" ? [snapshot] : []);
  });

  it("validates snapshot workflow transitions and ownership before changing the draft", async () => {
    const decision = protectedDecision();
    await saveDecision(decision);
    const snapshot = createSnapshot(decision, decision.options[0]!.id);
    snapshot.decision.workflow = undefined;
    await expect(saveSnapshot(snapshot, decision.revision)).rejects.toThrow("已封存预测不能移除");
    snapshot.decision.workflow = decision.workflow;
    snapshot.decisionId = "different-source";
    await expect(saveSnapshot(snapshot, decision.revision)).rejects.toThrow("snapshot-state-invalid");
    expect(await getDecision(decision.id)).toEqual(decision);
    expect(await listSnapshots()).toEqual([]);
  });
});

describe("additive backup transactions", () => {
  it("imports records additively and preserves archived result payloads", async () => {
    const decision = readyDecision();
    const snapshot = { ...createSnapshot(decision, decision.options[0]!.id), result: { archivedVersion: 1, legacyRevisionGap: true } };
    const preset = createPreset(decision, "imported preset");
    await replaceAll([decision], [snapshot], [preset]);
    expect(await listDecisions()).toEqual([decision]);
    expect(await listSnapshots()).toEqual([snapshot]);
    expect(await listPresets()).toEqual([preset]);
  });

  it("rolls back all incoming tables when a late preset conflict occurs", async () => {
    const decision = readyDecision();
    const snapshot = createSnapshot(decision, decision.options[0]!.id);
    const existingPreset = createPreset(decision, "local preset");
    await savePreset(existingPreset);
    await expect(replaceAll([decision], [snapshot], [{ ...existingPreset, name: "overwrite attempt" }])).rejects.toThrow();
    expect(await listDecisions()).toEqual([]);
    expect(await listSnapshots()).toEqual([]);
    expect(await listPresets()).toEqual([existingPreset]);
  });

  it("rolls back partial bulk adds instead of replacing a conflicting decision", async () => {
    const existing = readyDecision();
    const incoming = readyDecision();
    await saveDecision(existing);
    await expect(replaceAll([incoming, { ...existing, title: "replacement" }], [])).rejects.toThrow();
    expect(await getDecision(incoming.id)).toBeUndefined();
    expect(await getDecision(existing.id)).toEqual(existing);
  });
});
