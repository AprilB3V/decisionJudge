import { useCallback, useEffect, useRef, useState } from "react";
import { createDecision, createDecisionFromPreset, exportPayload } from "./application/decisionService";
import { DecisionSession } from "./application/decisionSession";
import { parseBackup, prepareBackupImport } from "./application/backup";
import type { Decision, Preset } from "./domain/types";
import { deleteDecision, deletePreset, getDecision, listDecisions, listPresets, listSnapshots, replaceAll, saveDecision, saveSnapshot } from "./infrastructure/localRepository";
import { Home } from "./components/Home";
import { Editor, downloadBackup } from "./components/Editor";

function App() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [session, setSession] = useState<DecisionSession>();
  const [showTemplates, setShowTemplates] = useState(false);
  const [importInputKey, setImportInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const [items, savedPresets] = await Promise.all([listDecisions(), listPresets()]);
    setDecisions(items);
    setPresets(savedPresets);
  }, []);
  useEffect(() => { void refresh().catch(() => setError("无法读取本地记录，请刷新后重试。")); }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试。"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const edit = (decision: Decision) => {
    setSession(new DecisionSession(decision, { save: saveDecision, snapshot: saveSnapshot }));
    setShowTemplates(false);
  };
  const create = async (decision: Decision) => {
    await saveDecision(decision);
    edit(decision);
  };
  const returnHome = async () => {
    await session?.flush();
    await refresh();
    setSession(undefined);
  };

  const handleDelete = async (id: string) => {
    const decision = await getDecision(id);
    if (!decision) {
      await refresh();
      return;
    }
    const snapshots = await listSnapshots(id);
    const name = decision.title.trim() || "未命名决策";
    const history = snapshots.length > 0 ? `，以及 ${snapshots.length} 份历史快照` : "";
    if (!window.confirm(`确定删除“${name}”吗？这将同时删除本机记录${history}，且无法撤销。`)) return;
    await deleteDecision(id, true);
    await refresh();
  };

  const handleExport = () => run(async () => {
    const [items, snapshots, savedPresets] = await Promise.all([listDecisions(), listSnapshots(), listPresets()]);
    downloadBackup(exportPayload(items, snapshots, savedPresets), `decisionjudge-backup-${new Date().toISOString().slice(0, 10)}.json`);
  });
  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void run(async () => {
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error("导入文件不能超过 10MB。");
        const payload = parseBackup(await file.text());
        const [items, snapshots, savedPresets] = await Promise.all([listDecisions(), listSnapshots(), listPresets()]);
        const incoming = prepareBackupImport(payload, { decisions: items, snapshots, presets: savedPresets });
        await replaceAll(incoming.decisions, incoming.snapshots, incoming.presets);
        await refresh();
        setNotice(`已导入 ${incoming.decisions.length} 项决策、${incoming.snapshots.length} 份快照和 ${incoming.presets.length} 个预设。`);
      } finally { setImportInputKey((key) => key + 1); }
    });
  };

  if (session) return <Editor key={session.getState().draft.id} session={session} onBack={returnHome} />;
  return <>
    {(error || notice || busy) && <div className={`app-notice ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error || (busy ? "正在处理本地记录…" : notice)}{error && <button onClick={() => { void run(refresh); }}>重试读取</button>}</div>}
    <div inert={busy} aria-busy={busy}>
      <Home key={importInputKey} decisions={decisions} presets={presets} showTemplates={showTemplates} setShowTemplates={setShowTemplates}
        onCreate={(id) => { void run(() => create(createDecision(id))); }}
        onUsePreset={(preset) => { void run(() => create(createDecisionFromPreset(preset))); }}
        onOpen={(id) => { void run(async () => { const item = await getDecision(id); if (!item) throw new Error("这项决策已被删除，请刷新列表。"); edit(item); }); }}
        onDelete={(id) => { void run(() => handleDelete(id)); }}
        onDeletePreset={(id) => { void run(async () => { await deletePreset(id); await refresh(); }); }}
        onExport={() => { void handleExport(); }} onImport={handleImport} />
    </div>
  </>;
}

export default App;
