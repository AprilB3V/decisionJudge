import Dexie, { type Table } from "dexie";
import type { Decision, Preset } from "../domain/types";
import { emptyWorkflow, validateWorkflow, validateWorkflowTransition } from "../domain/workflow";

export type SnapshotRecord = {
  id: string;
  decisionId: string;
  sourceRevision: number;
  chosenOptionId: string;
  schemaVersion: number;
  calculationVersion: string;
  decision: Decision;
  result: unknown;
  createdAt: string;
};

class DecisionDatabase extends Dexie {
  decisions!: Table<Decision, string>;
  snapshots!: Table<SnapshotRecord, string>;
  presets!: Table<Preset, string>;

  constructor() {
    super("decisionjudge-local");
    this.version(1).stores({
      decisions: "id, updatedAt, status, templateId",
      snapshots: "id, decisionId, createdAt",
      presets: "id, updatedAt, sourceTemplateId",
    });
  }
}

export const db = new DecisionDatabase();

export async function listDecisions() {
  return db.decisions.orderBy("updatedAt").reverse().toArray();
}

export async function getDecision(id: string) {
  return db.decisions.get(id);
}

export async function saveDecision(decision: Decision, expectedRevision?: number) {
  const next = structuredClone(decision);
  return db.transaction("rw", db.decisions, async () => {
    const existing = await db.decisions.get(next.id);
    assertRevision(existing, next, expectedRevision);
    assertWorkflow(existing, next);
    if (existing) await db.decisions.put(next);
    else await db.decisions.add(next);
    return next;
  });
}

function assertRevision(existing: Decision | undefined, next: Decision, expectedRevision?: number) {
  // Omitting the expected revision is an insert, never an unconditional overwrite.
  if (expectedRevision === undefined) {
    if (existing) throw new Error("revision-conflict");
    return;
  }
  if (!existing || existing.revision !== expectedRevision || next.revision !== expectedRevision + 1) {
    throw new Error("revision-conflict");
  }
}

function assertWorkflow(existing: Decision | undefined, next: Decision) {
  const workflow = next.workflow ?? emptyWorkflow();
  const validation = existing
    ? validateWorkflowTransition(existing.workflow ?? emptyWorkflow(), workflow, undefined, { allowSealedReplay: true })
    : validateWorkflow(workflow);
  if (!validation.valid) throw new Error(validation.errors.join("；"));
}

export async function deleteDecision(id: string, deleteSnapshots: boolean) {
  await db.transaction("rw", db.decisions, db.snapshots, async () => {
    await db.decisions.delete(id);
    if (deleteSnapshots) await db.snapshots.where("decisionId").equals(id).delete();
  });
}

export async function saveSnapshot(snapshot: SnapshotRecord, expectedRevision: number) {
  const next = structuredClone(snapshot);
  await db.transaction("rw", db.decisions, db.snapshots, async () => {
    if (expectedRevision === undefined) throw new Error("revision-conflict");
    if (next.decisionId !== next.decision.id || next.sourceRevision !== next.decision.revision
      || next.decision.status !== "decided" || next.chosenOptionId !== next.decision.chosenOptionId
      || !next.decision.options.some((option) => option.id === next.chosenOptionId)) {
      throw new Error("snapshot-state-invalid");
    }
    const existing = await db.decisions.get(next.decisionId);
    assertRevision(existing, next.decision, expectedRevision);
    assertWorkflow(existing, next.decision);
    await db.decisions.put(next.decision);
    // add() and the surrounding transaction keep an ID conflict from replacing history
    // or leaving the decision advanced without its corresponding snapshot.
    await db.snapshots.add(next);
  });
}

export async function listSnapshots(decisionId?: string) {
  return decisionId ? db.snapshots.where("decisionId").equals(decisionId).reverse().sortBy("createdAt") : db.snapshots.orderBy("createdAt").reverse().toArray();
}

export async function replaceAll(decisions: Decision[], snapshots: SnapshotRecord[], presets: Preset[] = []) {
  const incoming = structuredClone({ decisions, snapshots, presets });
  await db.transaction("rw", db.decisions, db.snapshots, db.presets, async () => {
    await db.decisions.bulkAdd(incoming.decisions);
    await db.snapshots.bulkAdd(incoming.snapshots);
    if (incoming.presets.length > 0) await db.presets.bulkAdd(incoming.presets);
  });
}

export async function listPresets() {
  return db.presets.orderBy("updatedAt").reverse().toArray();
}

export async function savePreset(preset: Preset) {
  await db.presets.put(preset);
  return preset;
}

export async function deletePreset(id: string) {
  await db.presets.delete(id);
}
