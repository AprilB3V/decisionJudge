import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPreset, evaluate, exportPayload } from "../application/decisionService";
import { DecisionSession } from "../application/decisionSession";
import { listSnapshots, savePreset, type SnapshotRecord } from "../infrastructure/localRepository";
import { DecisionWorkspace } from "./DecisionWorkspace";
import { ProblemStep, OptionsStep, WeightsStep, ScoresStep, ResultPanel } from "./DecisionSteps";
import { DecisionAssistant } from "./DecisionAssistant";

type Step = "problem" | "options" | "weights" | "scores" | "result";
const steps: Array<{ id: Step; label: string; hint: string }> = [
  { id: "problem", label: "明确问题", hint: "目标与边界" },
  { id: "options", label: "列出方案", hint: "可能性" },
  { id: "weights", label: "设置权重", hint: "改善与取舍" },
  { id: "scores", label: "逐项评分", hint: "比较依据" },
  { id: "result", label: "查看结果", hint: "取舍解释" },
];

export function downloadBackup(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Editor({ session, onBack }: { session: DecisionSession; onBack: () => Promise<void> }) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const { draft, dirty, saving, confirming, error } = state;
  const [section, setSection] = useState<"compare" | "evidence" | "review">("compare");
  const [step, setStep] = useState<Step>(draft.status === "decided" ? "result" : "problem");
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [localError, setLocalError] = useState("");
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetDescription, setPresetDescription] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const result = useMemo(() => evaluate(draft), [draft]);
  const stepIndex = steps.findIndex((item) => item.id === step);
  const weights = draft.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const ready: Record<Step, boolean> = {
    problem: !!draft.title.trim() && draft.constraints.every((item) => !!item.label.trim()),
    options: draft.options.length >= 2 && draft.options.every((item) => !!item.name.trim()),
    weights: draft.criteria.some((item) => item.weight > 0) && draft.criteria.every((item) => Number.isFinite(item.weight) && item.weight >= 0) && Math.abs(weights - 1) <= 0.001,
    scores: result.ready,
    result: result.ready,
  };

  useEffect(() => {
    if (!dirty || saving || confirming || error) return;
    const timer = window.setTimeout(() => { void session.flush().catch(() => {}); }, 450);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, saving, confirming, error, session]);

  useEffect(() => {
    if (!dirty && !confirming) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, confirming]);

  useEffect(() => {
    void listSnapshots(draft.id).then(setSnapshots).catch(() => setLocalError("无法读取历史快照，请重试。"));
  }, [draft.id, draft.status, draft.revision]);

  const confirm = async (id: string) => {
    await session.confirm(id);
    await listSnapshots(draft.id).then(setSnapshots).catch(() => setLocalError("快照已保存，但历史列表读取失败，请重新打开查看。"));
  };
  const goBack = async () => {
    setLeaving(true);
    try { await onBack(); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : "无法返回列表，请重试。"); }
    finally { setLeaving(false); }
  };
  const savePresetCopy = async () => {
    if (savingPreset) return;
    setSavingPreset(true);
    setLocalError("");
    try {
      await savePreset(createPreset(draft, presetName, presetDescription));
      setPresetOpen(false);
      setPresetName("");
      setPresetDescription("");
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "预设保存失败。"); }
    finally { setSavingPreset(false); }
  };
  const saveMessage = confirming ? "正在封存选择" : saving || dirty ? "尚有内容待保存" : "已保存在本机";

  return <div className="app-shell editor-shell">
    <header className="topbar">
      <button className="back-button" disabled={confirming || leaving} onClick={() => { void goBack(); }}>← <span>全部决策</span></button>
      <div className="brand-divider" /><div className="editor-name"><div className="editor-template">{draft.templateName}</div><div className="editor-title-small">{draft.title || "未命名决策"}</div></div>
      <div className="topbar-spacer" />
      <button className="header-action" disabled={confirming || leaving} onClick={() => setPresetOpen(true)}>保存为预设</button>
      <span className={`save-status ${error ? "error" : saving || dirty ? "saving" : "saved"}`} role="status">{error ? "请检查保存提示" : saveMessage}</span>
    </header>
    <main className="wizard-main">
      {(error || localError) && <div className="save-error-box" role="alert"><p>{error === "revision-conflict" ? "其他页面已修改这项决策。当前输入仍保留在页面，请导出当前草稿后重新打开，以免覆盖另一份修改。" : error || localError}</p><div><button type="button" onClick={() => { setLocalError(""); void session.flush().catch(() => {}); }}>重试保存</button><button type="button" onClick={() => downloadBackup(exportPayload([draft], [], []), "decisionjudge-unsaved-draft.json")}>导出当前草稿</button></div></div>}
      <div className="editor-tools"><div className="editor-mode" role="group" aria-label="编辑模式"><button type="button" disabled={confirming || leaving} aria-pressed={!draft.advancedUiExpanded} onClick={() => session.update({ advancedUiExpanded: false })}>普通模式</button><button type="button" disabled={confirming || leaving} aria-pressed={draft.advancedUiExpanded} onClick={() => session.update({ advancedUiExpanded: true })}>专业模式</button></div><button type="button" className="assistant-launch" aria-expanded={assistantOpen} disabled={confirming || leaving} onClick={() => setAssistantOpen(!assistantOpen)}>问答梳理 · 帮我开始</button></div>
      <DecisionAssistant open={assistantOpen} disabled={confirming || leaving} decision={draft} getDecision={() => session.getState().draft} onChange={session.update} onClose={() => setAssistantOpen(false)} onApplied={() => { setAssistantOpen(false); setSection("compare"); setStep("weights"); }} />
      <div hidden={assistantOpen}>
      <nav className="workspace-tabs" aria-label="决策工作区">
        {([ ["compare", "比较方案"], ["evidence", "验证与投入"], ["review", "行动与复盘"] ] as const).map(([id, label]) => <button key={id} type="button" aria-current={section === id ? "page" : undefined} className={section === id ? "active" : ""} onClick={() => setSection(id)}>{label}</button>)}
      </nav>
      <fieldset className="editor-fields" disabled={confirming || leaving}>
        {section === "compare" ? <>
          <div className="wizard-intro"><div><p className="eyebrow">决策向导 · {draft.advancedUiExpanded ? "专业模式" : "普通模式"}</p><h1>{steps[stepIndex]!.label}</h1><p>{draft.advancedUiExpanded ? "展开锚点、摆幅赋权和评分证据，仔细检查每一项判断。" : "先选出在意的方面，再比较各个方案。拿不准时，点上方问答梳理一起想清楚。"}</p></div></div>
          <nav className="wizard-progress" aria-label="决策步骤">{steps.map((item, index) => <button key={item.id} type="button" className={step === item.id ? "active" : ""} aria-current={step === item.id ? "step" : undefined} onClick={() => setStep(item.id)}><span className="wizard-step-index">{String(index + 1).padStart(2, "0")}</span><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>)}</nav>
          <div className="wizard-stage">
            {step === "problem" && <ProblemStep draft={draft} onUpdate={session.update} />}
            {step === "options" && <OptionsStep draft={draft} onUpdate={session.update} />}
            {step === "weights" && <WeightsStep draft={draft} onUpdate={session.update} />}
            {step === "scores" && <ScoresStep draft={draft} onUpdate={session.update} />}
            {step === "result" && <ResultPanel draft={draft} result={result} onSaveSnapshot={confirm} onReview={() => setSection("review")} />}
          </div>
          <div className="wizard-actions"><button className="secondary-button" type="button" disabled={stepIndex === 0} onClick={() => setStep(steps[stepIndex - 1]!.id)}>← 上一步</button><span className={`step-readiness ${ready[step] ? "ready" : ""}`}>{ready[step] ? "当前步骤已准备好" : step === "weights" ? `权重合计 ${(weights * 100).toFixed(1)}%，需合计 100%` : step === "scores" || step === "result" ? result.errors[0] : "请补齐当前步骤的必要信息"}</span>{stepIndex < steps.length - 1 && <button className="primary-button" type="button" disabled={!ready[step]} onClick={() => setStep(steps[stepIndex + 1]!.id)}>继续 →</button>}</div>
        </> : <DecisionWorkspace decision={draft} section={section} onChange={(workflow) => session.update({ workflow })} />}
      </fieldset>
      {section === "review" && <SnapshotHistory snapshots={snapshots} />}
      </div>
    </main>
    {presetOpen && <div className="dialog-backdrop"><section className="preset-dialog" role="dialog" aria-modal="true" aria-labelledby="preset-title"><h2 id="preset-title">保存可复用的比较结构</h2><p>只保存方案、维度、锚点与权重；本次评分、证据和执行记录不会进入预设。</p><label className="field-label">预设名称<input autoFocus value={presetName} onChange={(event) => setPresetName(event.target.value)} /></label><label className="field-label">备注<textarea value={presetDescription} onChange={(event) => setPresetDescription(event.target.value)} /></label>{localError && <p role="alert" className="workspace-alert">{localError}</p>}<div className="dialog-actions"><button className="secondary-button" onClick={() => setPresetOpen(false)}>取消</button><button className="primary-button" disabled={!presetName.trim() || savingPreset} onClick={() => { void savePresetCopy(); }}>保存预设</button></div></section></div>}
  </div>;
}

function SnapshotHistory({ snapshots }: { snapshots: SnapshotRecord[] }) {
  return <section className="snapshot-history"><h2>当时的决策快照</h2><p>快照保存当时的输入与结果，之后的修改会留在草稿中。</p>{snapshots.length === 0 ? <p>完成比较并确认选择后，这里会出现第一份快照。</p> : snapshots.map((snapshot) => <details className="workspace-card" key={snapshot.id}><summary><strong>{snapshot.decision.options.find((item) => item.id === snapshot.chosenOptionId)?.name ?? "历史选择"}</strong><span>{new Date(snapshot.createdAt).toLocaleString("zh-CN")}</span></summary><p>目标：{snapshot.decision.objective || "未填写"}</p><p>计算版本：{snapshot.calculationVersion}</p><div className="snapshot-evidence">{snapshot.decision.scores.map((score) => <p key={`${score.optionId}-${score.criterionId}`}><strong>{snapshot.decision.options.find((option) => option.id === score.optionId)?.name} · {snapshot.decision.criteria.find((criterion) => criterion.id === score.criterionId)?.name}</strong>：{score.value ?? "—"} 分{score.evidence ? `；${score.evidence}` : ""}</p>)}</div><button type="button" className="secondary-button" onClick={() => downloadBackup(exportPayload([], [snapshot]), `decisionjudge-snapshot-${snapshot.id}.json`)}>导出这份快照</button></details>)}</section>;
}
