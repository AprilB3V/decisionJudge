import { useCallback, useEffect, useMemo, useState } from "react";
import { createDecision, createSnapshot, evaluate, exportPayload, updateRevision } from "./application/decisionService";
import { templates } from "./domain/templates";
import type { Decision, EvaluationResult, TemplateId } from "./domain/types";
import { db, deleteDecision, listDecisions, listSnapshots, replaceAll, saveDecision, saveSnapshot } from "./infrastructure/localRepository";

type Screen = "home" | "editor";

function App() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [screen, setScreen] = useState<Screen>("home");
  const [draft, setDraft] = useState<Decision>();
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [showTemplates, setShowTemplates] = useState(false);
  const [importInputKey, setImportInputKey] = useState(0);

  const refresh = useCallback(async () => setDecisions(await listDecisions()), []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!draft || screen !== "editor" || !dirty) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        const saved = updateRevision(draft);
        await saveDecision(saved, draft.revision);
        setDraft(saved);
        setDirty(false);
        await refresh();
        setSaveState("saved");
      } catch { setSaveState("error"); }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, refresh, screen]);

  const openDecision = async (id: string) => {
    const item = await db.decisions.get(id);
    if (!item) return;
    setSelectedId(id); setDraft(item); setDirty(false); setScreen("editor"); setShowTemplates(false);
  };
  const startDecision = async (templateId: TemplateId) => {
    const item = createDecision(templateId);
    await saveDecision(item);
    await refresh();
    setSelectedId(item.id); setDraft(item); setDirty(false); setScreen("editor"); setShowTemplates(false);
  };
  const returnHome = async () => { await refresh(); setScreen("home"); setDraft(undefined); setDirty(false); setSelectedId(undefined); };
  const removeDecision = async (id: string) => { await deleteDecision(id, true); if (selectedId === id) await returnHome(); else await refresh(); };
  const update = (change: Partial<Decision>) => { setDirty(true); setDraft((current) => current ? { ...current, ...change } : current); };
  const result = useMemo<EvaluationResult | undefined>(() => draft ? evaluate(draft) : undefined, [draft]);

  const handleExport = async () => {
    const allDecisions = await listDecisions();
    const snapshots = await listSnapshots();
    const content = exportPayload(allDecisions, snapshots);
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `decisionjudge-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("导入文件不能超过 10MB。");
      const payload = JSON.parse(await file.text()) as { format?: string; formatVersion?: number; decisions?: Decision[]; snapshots?: Parameters<typeof replaceAll>[1] };
      if (payload.format !== "decisionjudge-export" || payload.formatVersion !== 1 || !Array.isArray(payload.decisions) || !Array.isArray(payload.snapshots)) throw new Error("文件格式不受支持。");
      const existing = await listDecisions();
      const existingIds = new Set(existing.map((item) => item.id));
      const imported = payload.decisions.map((item) => existingIds.has(item.id) ? { ...item, id: crypto.randomUUID(), revision: 1 } : item);
      await replaceAll(imported, payload.snapshots);
      await refresh();
      window.alert(`已导入 ${imported.length} 项决策。`);
    } catch (error) { window.alert(error instanceof Error ? error.message : "导入失败，请检查文件。"); }
    setImportInputKey((key) => key + 1);
  };

  if (screen === "home") return <Home key={importInputKey} decisions={decisions} showTemplates={showTemplates} setShowTemplates={setShowTemplates} onCreate={startDecision} onOpen={openDecision} onDelete={removeDecision} onExport={handleExport} onImport={handleImport} />;
  if (!draft || !result) return null;
  return <Editor draft={draft} result={result} saveState={saveState} onBack={returnHome} onUpdate={update} onSaveSnapshot={async (optionId) => {
    try { const snapshot = createSnapshot(draft, optionId); await saveSnapshot(snapshot); const decided = snapshot.decision; setDraft(decided); setDirty(false); await refresh(); }
    catch (error) { window.alert(error instanceof Error ? error.message : "请先完成评分"); }
  }} />;
}

function Home(props: { decisions: Decision[]; showTemplates: boolean; setShowTemplates: (value: boolean) => void; onCreate: (id: TemplateId) => void; onOpen: (id: string) => void; onDelete: (id: string) => void; onExport: () => void; onImport: (event: React.ChangeEvent<HTMLInputElement>) => void; }) {
  return <div className="app-shell"><header className="topbar"><div className="brand-mark">DJ</div><div><div className="brand-name">DecisionJudge</div><div className="brand-subtitle">把取舍变成可解释的选择</div></div><div className="topbar-spacer" /><div className="data-actions"><button className="header-action" onClick={props.onExport} disabled={props.decisions.length === 0}>导出</button><label className="header-action">导入<input type="file" accept="application/json,.json" onChange={props.onImport} hidden /></label></div><span className="local-pill"><span className="status-dot" />仅保存在本机</span></header>
    <main className="home-main"><section className="intro-band"><div><p className="eyebrow">深度决策工作台 / 低频 · 高重要</p><h1>先看清代价，<br /><em>再选择方向。</em></h1><p className="intro-copy">用权重、机会成本和未来效用，整理那些不该只凭感觉决定的事。</p><button className="primary-button" onClick={() => props.setShowTemplates(true)}>新建一项决策 <span>→</span></button></div><div className="intro-diagram" aria-label="决策模型示意"><div className="diagram-axis axis-x" /><div className="diagram-axis axis-y" /><div className="diagram-label label-top">长期价值</div><div className="diagram-label label-right">当下成本</div><div className="diagram-point point-a"><span>方案 A</span></div><div className="diagram-point point-b"><span>方案 B</span></div><div className="diagram-point point-c"><span>现状</span></div></div></section>
      {props.showTemplates && <section className="template-section"><div className="section-heading"><div><p className="eyebrow">选择一个起点</p><h2>这次要决定什么？</h2></div><button className="text-button" onClick={() => props.setShowTemplates(false)}>收起</button></div><div className="template-grid">{templates.map((template, index) => <button className="template-card" key={template.id} onClick={() => props.onCreate(template.id)}><span className="template-index">0{index + 1}</span><strong>{template.name}</strong><span>{template.description}</span><small>{template.concepts.join(" · ")}</small><span className="card-arrow">↗</span></button>)}</div></section>}
      <section className="recent-section"><div className="section-heading"><div><p className="eyebrow">本地记录</p><h2>最近的决策</h2></div><span className="muted-text">{props.decisions.length} 项</span></div>{props.decisions.length === 0 ? <div className="empty-state"><div className="empty-icon">□</div><strong>还没有保存的决策</strong><span>从一个重要问题开始，给直觉一份可以复查的依据。</span></div> : <div className="decision-list">{props.decisions.map((decision) => <div className="decision-row" key={decision.id}><button className="decision-open" onClick={() => props.onOpen(decision.id)}><span className="decision-status">{decision.status === "decided" ? "已做选择" : "草稿"}</span><strong>{decision.title}</strong><span>{decision.templateName} · {new Date(decision.updatedAt).toLocaleDateString("zh-CN")}</span></button><button className="icon-text-button danger" title="删除这项决策" onClick={() => props.onDelete(decision.id)}>删除</button></div>)}</div>}</section>
    </main><footer className="app-footer"><span>DecisionJudge 0.1</span><span>你的决策数据不会离开这台设备</span><span>MPL-2.0</span></footer></div>;
}

function Editor({ draft, result, saveState, onBack, onUpdate, onSaveSnapshot }: { draft: Decision; result: EvaluationResult; saveState: "saved" | "saving" | "error"; onBack: () => void; onUpdate: (change: Partial<Decision>) => void; onSaveSnapshot: (optionId: string) => Promise<void>; }) {
  const [activeTab, setActiveTab] = useState<"inputs" | "result">("inputs");
  const setScore = (optionId: string, criterionId: string, value: number) => onUpdate({ scores: draft.scores.map((score) => score.optionId === optionId && score.criterionId === criterionId ? { ...score, value } : score) });
  const setWeight = (criterionId: string, value: number) => {
    const numeric = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) / 100 : 0;
    onUpdate({ criteria: draft.criteria.map((criterion) => criterion.id === criterionId ? { ...criterion, weight: numeric } : criterion) });
  };
  return <div className="app-shell editor-shell"><header className="topbar"><button className="back-button" onClick={onBack}>← <span>全部决策</span></button><div className="brand-divider" /><div><div className="editor-template">{draft.templateName}</div><div className="editor-title-small">{draft.title}</div></div><div className="topbar-spacer" /><span className={`save-status ${saveState}`}>{saveState === "saving" ? "正在保存" : saveState === "error" ? "保存失败" : "已保存在本机"}</span></header>
    <main className="editor-main"><div className="editor-head"><div><p className="eyebrow">决策工作台</p><input className="title-input" value={draft.title} onChange={(event) => onUpdate({ title: event.target.value })} aria-label="决策标题" /><textarea className="objective-input" value={draft.objective} onChange={(event) => onUpdate({ objective: event.target.value })} placeholder="用一句话写下你真正想解决的问题" aria-label="决策目标" /></div><div className="mode-control"><span>基础模式</span><button className={`advanced-toggle ${draft.advancedUiExpanded ? "on" : ""}`} onClick={() => onUpdate({ advancedUiExpanded: !draft.advancedUiExpanded })} aria-pressed={draft.advancedUiExpanded}><span className="toggle-knob" /></button><span className={draft.advancedUiExpanded ? "active-label" : ""}>高级模式</span></div></div>
      <div className="tab-bar"><button className={activeTab === "inputs" ? "active" : ""} onClick={() => setActiveTab("inputs")}>整理输入</button><button className={activeTab === "result" ? "active" : ""} onClick={() => setActiveTab("result")}>查看结果 {result.ready && <span className="tab-badge">{result.rows.length}</span>}</button></div>
      {activeTab === "inputs" ? <InputPanel draft={draft} result={result} setScore={setScore} setWeight={setWeight} onUpdate={onUpdate} /> : <ResultPanel draft={draft} result={result} onSaveSnapshot={onSaveSnapshot} />}
    </main></div>;
}

function InputPanel({ draft, result, setScore, setWeight, onUpdate }: { draft: Decision; result: EvaluationResult; setScore: (optionId: string, criterionId: string, value: number) => void; setWeight: (criterionId: string, value: number) => void; onUpdate: (change: Partial<Decision>) => void; }) {
  const weightTotal = Math.round(draft.criteria.reduce((sum, criterion) => sum + criterion.weight * 100, 0));
  const addOption = () => {
    const optionId = crypto.randomUUID();
    onUpdate({
      options: [...draft.options, { id: optionId, name: `新方案 ${draft.options.length + 1}`, description: "", isStatusQuo: false }],
      scores: [...draft.scores, ...draft.criteria.map((criterion) => ({ optionId, criterionId: criterion.id, value: null, evidence: "" }))],
    });
  };
  const removeOption = (optionId: string) => {
    if (draft.options.length <= 2) return;
    onUpdate({
      options: draft.options.filter((option) => option.id !== optionId),
      scores: draft.scores.filter((score) => score.optionId !== optionId),
      constraints: draft.constraints.map((constraint) => {
        const evaluations = { ...constraint.evaluations };
        delete evaluations[optionId];
        return { ...constraint, evaluations };
      }),
      chosenOptionId: draft.chosenOptionId === optionId ? undefined : draft.chosenOptionId,
      status: draft.chosenOptionId === optionId ? "draft" : draft.status,
    });
  };
  return <div className="input-layout"><div className="input-column"><section className="panel"><div className="panel-heading"><div><span className="step-number">01</span><div><p className="eyebrow">先定义问题</p><h2>你正在权衡什么？</h2></div></div><span className="concept-tag">稀缺性与约束</span></div><label className="field-label">决策截止时间 <input type="date" value={draft.decisionDate} onChange={(event) => onUpdate({ decisionDate: event.target.value })} /></label><div className="field-hint">给自己设一个时间边界，避免无限比较。</div><label className="field-label">不可妥协的约束 <textarea placeholder="例如：预算不能超过 10 万；必须留在当前城市" value={draft.constraints.map((constraint) => constraint.label).join("\n")} onChange={(event) => { const labels = event.target.value.split("\n").filter(Boolean); onUpdate({ constraints: labels.map((label, index) => ({ id: draft.constraints[index]?.id ?? crypto.randomUUID(), label, description: "", evaluations: {} })) }); }} /></label><div className="field-hint"><strong>硬约束先于评分。</strong> 不符合约束的方案不会进入排名。</div></section>
      <section className="panel"><div className="panel-heading"><div><span className="step-number">02</span><div><p className="eyebrow">列出可能性</p><h2>有哪些方案？</h2></div></div><span className="concept-tag">包含维持现状</span></div><div className="option-stack">{draft.options.map((option, index) => <div className="option-entry" key={option.id}><div className="option-number">{String(index + 1).padStart(2, "0")}</div><div className="option-fields"><input value={option.name} onChange={(event) => onUpdate({ options: draft.options.map((item) => item.id === option.id ? { ...item, name: event.target.value } : item) })} aria-label={`方案 ${index + 1} 名称`} /><input value={option.description} onChange={(event) => onUpdate({ options: draft.options.map((item) => item.id === option.id ? { ...item, description: event.target.value } : item) })} placeholder="补充这个方案的关键假设" aria-label={`方案 ${index + 1} 描述`} /></div>{option.isStatusQuo && <span className="status-quo-label">现状</span>}</div>)}</div><button className="add-line-button" onClick={() => onUpdate({ options: [...draft.options, { id: crypto.randomUUID(), name: `新方案 ${draft.options.length + 1}`, description: "", isStatusQuo: false }] })}>＋ 添加一个方案</button><div className="field-hint concept-callout"><strong>机会成本</strong><span>选择 A 的代价，不只是 A 的价格，也包括你放弃的最佳替代方案。</span></div></section>
      <section className="panel"><div className="panel-heading"><div><span className="step-number">03</span><div><p className="eyebrow">分配重要性</p><h2>什么对你更重要？</h2></div></div><span className={`weight-total ${weightTotal === 100 ? "complete" : "warning"}`}>{weightTotal}% / 100%</span></div><div className="criteria-list">{draft.criteria.map((criterion) => <div className="criterion-row" key={criterion.id}><div className="criterion-copy"><strong>{criterion.name}</strong><span>{criterion.description}</span></div><input className="weight-input" type="number" min="0" max="100" value={Math.round(criterion.weight * 100)} onChange={(event) => setWeight(criterion.id, Number(event.target.value))} /><span>%</span><div className="weight-bar"><span style={{ width: `${criterion.weight * 100}%` }} /></div></div>)}</div><div className="field-hint">权重代表你愿意把多少注意力放在这个维度上，不代表它的客观价值。</div></section>
      {draft.advancedUiExpanded && <section className="panel advanced-panel"><div className="panel-heading"><div><span className="step-number">04</span><div><p className="eyebrow">专业微调</p><h2>只打开你真正需要的参数</h2></div></div><span className="concept-tag">高级模式</span></div><AdvancedSwitch label="维度内因素" description="将一个维度拆成多个因素并分别加权。" enabled={draft.advanced.factorsEnabled} onChange={(enabled) => onUpdate({ advanced: { ...draft.advanced, factorsEnabled: enabled } })} /><AdvancedSwitch label="情景与概率" description="比较乐观、基准、悲观三种未来。" enabled={draft.advanced.scenariosEnabled} onChange={(enabled) => onUpdate({ advanced: { ...draft.advanced, scenariosEnabled: enabled } })} /><AdvancedSwitch label="风险偏好" description="让下行结果对推荐产生可见影响。" enabled={draft.advanced.riskEnabled} onChange={(enabled) => onUpdate({ advanced: { ...draft.advanced, riskEnabled: enabled } })} /><AdvancedSwitch label="时间价值与折现" description="把跨期现金流折算到同一个时间点。" enabled={draft.advanced.discountingEnabled} onChange={(enabled) => onUpdate({ advanced: { ...draft.advanced, discountingEnabled: enabled } })} /><p className="advanced-note">高级模块的参数会保存在这项决策中；当前基础评分仍以 1–10 分为主。</p></section>}
    </div><aside className="side-column"><section className="score-panel"><div className="panel-heading compact"><div><p className="eyebrow">快速评分</p><h2>每个方案打几分？</h2></div><span className="score-scale">1 — 10</span></div><div className="score-table-wrap"><table className="score-table"><thead><tr><th>评价维度</th>{draft.options.map((option) => <th key={option.id}>{option.name || "未命名"}</th>)}</tr></thead><tbody>{draft.criteria.map((criterion) => <tr key={criterion.id}><th><strong>{criterion.name}</strong><small>{criterion.lowAnchor} ↔ {criterion.highAnchor}</small></th>{draft.options.map((option) => { const score = draft.scores.find((item) => item.optionId === option.id && item.criterionId === criterion.id); return <td key={option.id}><input type="number" min="1" max="10" placeholder="—" value={score?.value ?? ""} onChange={(event) => { const parsed = Number(event.target.value); if (parsed >= 1 && parsed <= 10) setScore(option.id, criterion.id, parsed); }} aria-label={`${option.name} ${criterion.name} 评分`} /></td>; })}</tr>)}</tbody></table></div>{!result.ready && <div className="score-warning"><span>!</span><div><strong>还差一点就能看到结果</strong><span>{result.errors[0]}</span></div></div>}</section><section className="education-panel"><div className="education-icon">i</div><div><strong>沉没成本提醒</strong><p>已经花掉的时间、钱或精力，如果无法收回，就不应继续影响未来的选择。把它记录下来，是为了识别它。</p></div></section></aside></div>;
}

function AdvancedSwitch({ label, description, enabled, onChange }: { label: string; description: string; enabled: boolean; onChange: (enabled: boolean) => void }) { return <div className="advanced-switch"><div><strong>{label}</strong><span>{description}</span></div><button className={`mini-toggle ${enabled ? "on" : ""}`} onClick={() => onChange(!enabled)} aria-pressed={enabled}><span /></button></div>; }

function ResultPanel({ draft, result, onSaveSnapshot }: { draft: Decision; result: EvaluationResult; onSaveSnapshot: (optionId: string) => Promise<void> }) {
  const winner = result.rows[0];
  return <div className="result-layout"><section className="result-hero panel"><div><p className="eyebrow">评估结果 · {result.calculationVersion}</p><h1>{result.ready ? "把选择交还给你。" : "先补齐几个关键输入。"}</h1><p>{result.ready ? "模型不会替你做决定，但会把取舍、放弃和结论稳定性摆到台面上。" : result.errors.join(" ")}</p></div>{result.ready && <div className={`stability-badge ${result.stability}`}><span className="stability-dot" />{result.stability === "stable" ? "结论相对稳定" : result.stability === "sensitive" ? "结论对权重敏感" : "信息还不完整"}</div>}</section>{result.ready && winner ? <><section className="ranking-section"><div className="section-heading"><div><p className="eyebrow">综合效用排序</p><h2>没有唯一正确答案，只有当前假设下的比较。</h2></div><span className="muted-text">满分 10.00</span></div><div className="ranking-list">{result.rows.map((row) => { const option = draft.options.find((item) => item.id === row.optionId)!; return <div className={`ranking-row ${row.rank === 1 ? "winner" : ""}`} key={row.optionId}><div className="rank-number">{String(row.rank).padStart(2, "0")}</div><div className="rank-main"><div className="rank-title"><strong>{option.name}</strong>{row.rank === 1 && <span className="recommended-tag">当前排序第一</span>}</div><div className="utility-bar"><span style={{ width: `${row.utility * 10}%` }} /></div><div className="rank-meta"><span>综合效用 {row.utility.toFixed(2)}</span><span>{row.bestForegoneOptionId ? `机会成本：放弃 ${draft.options.find((item) => item.id === row.bestForegoneOptionId)?.name}` : ""}</span></div></div><div className="rank-score">{row.utility.toFixed(2)}</div></div>; })}</div></section><section className="result-grid"><div className="panel insight-panel"><div className="panel-heading compact"><div><p className="eyebrow">为什么会是这个排序？</p><h2>最有影响力的因素</h2></div></div><div className="insight-list">{result.decisiveCriteria.map((criterion) => <div className="insight-item" key={criterion}><span className="insight-marker" /><span>{criterion}</span><small>权重与方案差异共同放大了它的影响</small></div>)}</div><div className="net-advantage"><span>第一名相对次优方案的净优势</span><strong>+{(winner.netAdvantageOverNextBest ?? 0).toFixed(2)}</strong></div></div><div className="panel opportunity-panel"><div className="panel-heading compact"><div><p className="eyebrow">被放弃的价值</p><h2>机会成本</h2></div><span className="concept-tag">Opportunity cost</span></div><p>如果选择 <strong>{draft.options.find((item) => item.id === winner.optionId)?.name}</strong>，当前模型认为你放弃的最佳可行替代是：</p><div className="foregone-option">{draft.options.find((item) => item.id === winner.bestForegoneOptionId)?.name ?? "暂无"}<span>效用 {winner.bestForegoneUtility?.toFixed(2) ?? "—"}</span></div><div className="field-hint">机会成本不是要再扣一次的分数，而是帮助你看见这次取舍的另一面。</div></div></section><section className="result-grid"><div className="panel notices-panel"><div className="panel-heading compact"><div><p className="eyebrow">模型旁白</p><h2>值得带走的提醒</h2></div></div>{result.notices.map((notice) => <div className="notice-row" key={notice.concept}><span className="notice-index">{notice.concept === "sunk" ? "01" : notice.concept === "opportunity" ? "02" : notice.concept === "constraint" ? "03" : "04"}</span><div><strong>{notice.title}</strong><p>{notice.body}</p></div></div>)}</div><div className="panel snapshot-panel"><div className="panel-heading compact"><div><p className="eyebrow">确认你的选择</p><h2>保存一张决策快照</h2></div></div><p>快照会封存当前输入、结果和计算版本，之后修改草稿也不会改变它。</p><label className="field-label">我最终选择 <select defaultValue={draft.chosenOptionId ?? winner.optionId} id="chosen-option"><option value="">请选择</option>{result.rows.map((row) => <option value={row.optionId} key={row.optionId}>{draft.options.find((item) => item.id === row.optionId)?.name}</option>)}</select></label><button className="primary-button full" onClick={() => { const select = document.getElementById("chosen-option") as HTMLSelectElement; void onSaveSnapshot(select.value); }}>{draft.status === "decided" ? "再次保存快照" : "确认并保存快照"} <span>→</span></button></div></section></> : <div className="empty-result"><span>◎</span><strong>完成评分后，这里会出现可解释的排序。</strong><p>先回到“整理输入”，给每个方案在每个维度上打分。</p></div>}</div>;
}

export default App;
