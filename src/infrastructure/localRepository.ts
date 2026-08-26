import Dexie, { type Table } from "dexie";
import type { Decision, Preset } from "../domain/types";

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
  const existing = await db.decisions.get(decision.id);
  if (existing && expectedRevision !== undefined && existing.revision !== expectedRevision) throw new Error("revision-conflict");
  await db.decisions.put(decision);
  return decision;
}

export async function deleteDecision(id: string, deleteSnapshots: boolean) {
  await db.transaction("rw", db.decisions, db.snapshots, async () => {
    await db.decisions.delete(id);
    if (deleteSnapshots) await db.snapshots.where("decisionId").equals(id).delete();
  });
}

export async function saveSnapshot(snapshot: SnapshotRecord) {
  await db.transaction("rw", db.decisions, db.snapshots, async () => {
    await db.decisions.put(snapshot.decision);
    await db.snapshots.add(snapshot);
  });
}

export async function listSnapshots(decisionId?: string) {
  return decisionId ? db.snapshots.where("decisionId").equals(decisionId).reverse().sortBy("createdAt") : db.snapshots.orderBy("createdAt").reverse().toArray();
}

export async function replaceAll(decisions: Decision[], snapshots: SnapshotRecord[], presets: Preset[] = []) {
  await db.transaction("rw", db.decisions, db.snapshots, db.presets, async () => {
    await db.decisions.bulkPut(decisions);
    await db.snapshots.bulkPut(snapshots);
    if (presets.length > 0) await db.presets.bulkPut(presets);
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
