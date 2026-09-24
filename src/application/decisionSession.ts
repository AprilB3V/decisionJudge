import type { Decision } from "../domain/types";
import { applyDecisionChange, createSnapshot, updateRevision } from "./decisionService";

type Snapshot = ReturnType<typeof createSnapshot>;
export type SessionState = {
  draft: Decision;
  dirty: boolean;
  saving: boolean;
  confirming: boolean;
  error: string;
};

export type SessionStorage = {
  save: (decision: Decision, expectedRevision: number) => Promise<Decision>;
  snapshot: (snapshot: Snapshot, expectedRevision: number) => Promise<void>;
};

/** Serializes writes and preserves edits that arrive while an older revision is saving. */
export class DecisionSession {
  private state: SessionState;
  private editNumber = 0;
  private inFlight?: Promise<void>;
  private listeners = new Set<() => void>();

  constructor(decision: Decision, private readonly storage: SessionStorage) {
    this.state = { draft: decision, dirty: false, saving: false, confirming: false, error: "" };
  }

  getState = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(change: Partial<SessionState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  update = (change: Partial<Decision>): boolean => {
    if (this.state.confirming) return false;
    try {
      const next = applyDecisionChange(this.state.draft, change);
      this.editNumber += 1;
      this.publish({ draft: next, dirty: true, error: "" });
      return true;
    } catch (error) {
      this.publish({ error: error instanceof Error ? error.message : "输入无法保存，请检查内容。" });
      return false;
    }
  };

  flush = (): Promise<void> => {
    if (this.inFlight) return this.inFlight;
    if (!this.state.dirty) return Promise.resolve();
    // Assign the promise before writes begin, so all callers await the same drain.
    this.inFlight = Promise.resolve().then(async () => {
      this.publish({ saving: true, error: "" });
      try {
        while (this.state.dirty) {
          const source = this.state.draft;
          const editNumber = this.editNumber;
          const saved = await this.storage.save(updateRevision(source), source.revision);
          const hasNewEdits = editNumber !== this.editNumber;
          this.publish({
            draft: hasNewEdits
              ? { ...this.state.draft, revision: saved.revision, calculationVersion: saved.calculationVersion }
              : saved,
            dirty: hasNewEdits,
          });
        }
      } catch (error) {
        this.publish({ error: error instanceof Error ? error.message : "本地保存失败，请重试。" });
        throw error;
      } finally {
        this.inFlight = undefined;
        this.publish({ saving: false });
      }
    });
    return this.inFlight;
  };

  confirm = async (optionId: string): Promise<Snapshot> => {
    if (this.state.confirming) throw new Error("正在保存快照，请稍候。");
    this.publish({ confirming: true, error: "" });
    try {
      await this.flush();
      const source = this.state.draft;
      const snapshot = createSnapshot(source, optionId);
      await this.storage.snapshot(snapshot, source.revision);
      this.publish({ draft: snapshot.decision, dirty: false });
      return snapshot;
    } catch (error) {
      this.publish({ error: error instanceof Error ? error.message : "快照保存失败。" });
      throw error;
    } finally {
      this.publish({ confirming: false });
    }
  };
}
