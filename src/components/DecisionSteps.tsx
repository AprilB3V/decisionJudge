import { useEffect, useMemo, useRef, useState } from "react";
import type { Constraint, Decision, EvaluationResult, Score } from "../domain/types";
import "./decision-steps.css";
import { SimpleWeightsStep, SimpleScoresStep } from "./SimpleComparison";

export type DecisionStepProps = {
  draft: Decision;
  onUpdate: (change: Partial<Decision>) => void;
};

type ConstraintStatus = "feasible" | "infeasible" | "unknown";
type EvidenceKind = NonNullable<Score["evidenceKind"]>;
type EvidenceConfidence = NonNullable<Score["evidenceConfidence"]>;

const createId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `decision-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

const optionLabel = (name: string, index: number) => name.trim() || `未命名方案 ${index + 1}`;

const updateConstraint = (constraints: Constraint[], id: string, change: Partial<Constraint>) =>
  constraints.map((constraint) => constraint.id === id ? { ...constraint, ...change } : constraint);

const statusForOption = (draft: Decision, optionId: string): ConstraintStatus => {
  let unknown = false;
  for (const constraint of draft.constraints) {
    const status = constraint.evaluations[optionId];
    if (status === "infeasible") return "infeasible";
    if (status !== "feasible") unknown = true;
  }
  return unknown ? "unknown" : "feasible";
};

const statusText: Record<ConstraintStatus, string> = {
  feasible: "已满足",
  infeasible: "不满足，跳过评分",
  unknown: "未知，先标记再验证",
};

/** The problem step keeps every hard constraint as an object with its own id. */
export function ProblemStep({ draft, onUpdate }: DecisionStepProps) {
  const commitConstraints = (constraints: Constraint[]) => {
    const chosenIsInvalid = draft.chosenOptionId !== undefined
      && constraints.some((constraint) => constraint.evaluations[draft.chosenOptionId!] !== "feasible");
    onUpdate({
      constraints,
      ...(chosenIsInvalid ? { chosenOptionId: undefined, status: "draft" as const } : {}),
    });
  };

  const addConstraint = () => commitConstraints([...draft.constraints, { id: createId(), label: "", description: "", evaluations: {} }]);

  const removeConstraint = (id: string) => commitConstraints(draft.constraints.filter((constraint) => constraint.id !== id));

  const changeConstraint = (id: string, change: Partial<Constraint>) => {
    const previous = draft.constraints.find((constraint) => constraint.id === id);
    const wordingChanged = previous && (
      (change.label !== undefined && change.label !== previous.label)
      || (change.description !== undefined && change.description !== previous.description)
    );
    commitConstraints(updateConstraint(draft.constraints, id, wordingChanged ? { ...change, evaluations: {} } : change));
  };

  const setConstraintStatus = (constraintId: string, optionId: string, value: ConstraintStatus) => {
    const next = draft.constraints.map((constraint) => constraint.id === constraintId
      ? { ...constraint, evaluations: { ...constraint.evaluations, [optionId]: value } }
      : constraint);
    commitConstraints(next);
  };

  return <section className="dj-step-card" aria-labelledby="problem-step-title">
    <div className="dj-step-header">
      <div><p className="dj-eyebrow">01 / 05 · 目的与边界</p><h2 id="problem-step-title">先说清楚，你真正想解决什么？</h2><p>先写期望得到的结果，再写不可妥协的约束。行动手段放到方案里比较。</p></div>
      <span className="dj-tag">目的 ≠ 手段</span>
    </div>
    <div className="dj-form dj-form-narrow">
      <label className="dj-field">给这项决策起个名字
        <input value={draft.title} onChange={(event) => onUpdate({ title: event.target.value })} placeholder="例如：毕业后继续读研还是直接工作" autoFocus />
      </label>
      <label className="dj-field">这次选择想实现什么结果？（目的）
        <textarea value={draft.objective} onChange={(event) => onUpdate({ objective: event.target.value })} placeholder="用未来想得到的变化来描述，例如：三年内获得更好的成长，同时保持可承受的经济压力。" />
        <span className="dj-help">尽量写结果、价值或状态；“报某个课程”“搬到某城市”属于实现目的的手段，应列为方案。</span>
      </label>
      <label className="dj-field dj-field-short">希望在什么时候做出决定？
        <input type="date" value={draft.decisionDate} onChange={(event) => onUpdate({ decisionDate: event.target.value })} />
      </label>
    </div>

    <div className="dj-constraint-section">
      <div className="dj-section-title"><div><h3>不可妥协的硬约束</h3><p>预算、时间、地点或资格等底线会先决定方案是否可行。</p></div><button type="button" className="dj-secondary-button" onClick={addConstraint}>＋ 添加约束</button></div>
      {draft.constraints.length === 0 && <p className="dj-empty">还没有硬约束。只有确实会淘汰方案的条件才放在这里。</p>}
      <div className="dj-constraint-list">
        {draft.constraints.map((constraint, index) => <article className="dj-constraint-card" key={constraint.id}>
          <div className="dj-constraint-edit">
            <span className="dj-index">{String(index + 1).padStart(2, "0")}</span>
            <div className="dj-constraint-inputs">
              <label className="sr-only" htmlFor={`constraint-${constraint.id}`}>约束 {index + 1}</label>
              <input id={`constraint-${constraint.id}`} value={constraint.label} onChange={(event) => changeConstraint(constraint.id, { label: event.target.value })} placeholder="例如：预算不能超过 10 万元" />
              <input value={constraint.description} onChange={(event) => changeConstraint(constraint.id, { description: event.target.value })} placeholder="补充可验证的判定方式（可选）" aria-label={`约束 ${index + 1} 说明`} />
            </div>
            <button type="button" className="dj-icon-button" onClick={() => removeConstraint(constraint.id)} aria-label={`删除约束 ${index + 1}`}>×</button>
          </div>
          <div className="dj-constraint-evaluations">
            {draft.options.length === 0 && <span className="dj-help">先在下一步添加方案，再标记每个方案是否满足。</span>}
            {draft.options.map((option, optionIndex) => <label className="dj-constraint-evaluation" key={option.id}>
              <span>{optionLabel(option.name, optionIndex)}</span>
              <select value={constraint.evaluations[option.id] ?? "unknown"} onChange={(event) => setConstraintStatus(constraint.id, option.id, event.target.value as ConstraintStatus)} aria-label={`${optionLabel(option.name, optionIndex)}是否满足${constraint.label || "该约束"}`}>
                <option value="feasible">已满足</option><option value="infeasible">不满足</option><option value="unknown">未知</option>
              </select>
            </label>)}
          </div>
        </article>)}
      </div>
    </div>
    <div className="dj-note"><strong>先处理约束</strong><span>“未知”不会自动淘汰方案，但结果页会标记它仍需验证。只有“已满足”的方案才可直接保存为最终快照。</span></div>
  </section>;
}

/** Options are edited by id so adding or removing a row never moves another option's data. */
export function OptionsStep({ draft, onUpdate }: DecisionStepProps) {
  const addOption = () => onUpdate({
    options: [...draft.options, { id: createId(), name: `新方案 ${draft.options.length + 1}`, description: "", isStatusQuo: false }],
  });

  const removeOption = (optionId: string) => {
    if (draft.options.length <= 2) return;
    const wasChosen = draft.chosenOptionId === optionId;
    const constraints = draft.constraints.map((constraint) => {
      const evaluations = { ...constraint.evaluations };
      delete evaluations[optionId];
      return { ...constraint, evaluations };
    });
    onUpdate({
      options: draft.options.filter((option) => option.id !== optionId),
      scores: draft.scores.filter((score) => score.optionId !== optionId),
      constraints,
      chosenOptionId: wasChosen ? undefined : draft.chosenOptionId,
      status: wasChosen ? "draft" : draft.status,
      workflow: draft.workflow ? {
        ...draft.workflow,
        verificationTasks: draft.workflow.verificationTasks.map((task) => task.optionId === optionId
          ? { ...task, optionId: undefined }
          : task),
      } : undefined,
    });
  };

  const updateOption = (optionId: string, change: Partial<Decision["options"][number]>) => onUpdate({
    options: draft.options.map((option) => option.id === optionId ? { ...option, ...change } : option),
  });

  const setStatusQuo = (optionId: string, checked: boolean) => onUpdate({
    options: draft.options.map((option) => ({ ...option, isStatusQuo: checked && option.id === optionId })),
  });

  return <section className="dj-step-card" aria-labelledby="options-step-title">
    <div className="dj-step-header"><div><p className="dj-eyebrow">02 / 05 · 方案空间</p><h2 id="options-step-title">把可能的路一条条写下来</h2><p>先求完整，不急着判断。保留现状或延后决定，才能看见真正的机会成本。</p></div><span className="dj-tag">至少两个方案</span></div>
    <div className="dj-option-list">
      {draft.options.map((option, index) => <article className="dj-option-card" key={option.id}>
        <span className="dj-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="dj-option-fields">
          <label className="sr-only" htmlFor={`option-name-${option.id}`}>方案 {index + 1} 名称</label>
          <input id={`option-name-${option.id}`} value={option.name} onChange={(event) => updateOption(option.id, { name: event.target.value })} placeholder="方案名称" />
          <label className="sr-only" htmlFor={`option-description-${option.id}`}>方案 {index + 1} 描述</label>
          <textarea id={`option-description-${option.id}`} value={option.description} onChange={(event) => updateOption(option.id, { description: event.target.value })} placeholder="这个方案意味着什么？关键前提是什么？" />
        </div>
        <div className="dj-option-tools">
          <label className="dj-status-check"><input type="checkbox" checked={option.isStatusQuo} onChange={(event) => setStatusQuo(option.id, event.target.checked)} /> <span>现状 / 延后</span></label>
          <button type="button" className="dj-icon-button" disabled={draft.options.length <= 2} onClick={() => removeOption(option.id)} aria-label={`删除${optionLabel(option.name, index)}`} title={draft.options.length <= 2 ? "至少保留两个方案" : "删除方案"}>×</button>
        </div>
      </article>)}
    </div>
    <button type="button" className="dj-add-button" onClick={addOption}>＋ 添加另一种可能</button>
    <div className="dj-note"><strong>生成提示</strong><span>分别想一遍：维持现状、延后决定、缩小试行、组合两个方案，或先做一个低成本实验。它们都可以成为候选路径。</span></div>
  </section>;
}

export function WeightsStep(props: DecisionStepProps) {
  return props.draft.advancedUiExpanded ? <ProfessionalWeightsStep {...props} /> : <SimpleWeightsStep {...props} />;
}

function ProfessionalWeightsStep({ draft, onUpdate }: DecisionStepProps) {
  const weightTotal = Math.round(draft.criteria.reduce((sum, criterion) => sum + criterion.weight * 100, 0));
  const baselineAnchors = useRef(new Map(draft.criteria.map((criterion) => [criterion.id, `${criterion.lowAnchor}\u0000${criterion.highAnchor}`])));
  const [changedAnchorIds, setChangedAnchorIds] = useState<Set<string>>(new Set());
  const [swingValues, setSwingValues] = useState<Record<string, string>>(() => Object.fromEntries(draft.criteria.map((criterion) => [criterion.id, String(Math.round(criterion.weight * 100))])));
  const [swingMessage, setSwingMessage] = useState("");

  useEffect(() => {
    setSwingValues((current) => {
      const next = { ...current };
      for (const criterion of draft.criteria) if (next[criterion.id] === undefined) next[criterion.id] = String(Math.round(criterion.weight * 100));
      return next;
    });
  }, [draft.criteria]);

  const updateCriterion = (criterionId: string, change: Partial<Decision["criteria"][number]>) => onUpdate({
    criteria: draft.criteria.map((criterion) => criterion.id === criterionId ? { ...criterion, ...change } : criterion),
  });

  const setAnchor = (criterionId: string, field: "lowAnchor" | "highAnchor", value: string) => {
    const criterion = draft.criteria.find((item) => item.id === criterionId);
    if (!criterion) return;
    const next = new Set(changedAnchorIds);
    const nextLow = field === "lowAnchor" ? value : criterion.lowAnchor;
    const nextHigh = field === "highAnchor" ? value : criterion.highAnchor;
    if (baselineAnchors.current.get(criterionId) === `${nextLow}\u0000${nextHigh}`) next.delete(criterionId); else next.add(criterionId);
    setChangedAnchorIds(next);
    setSwingValues((current) => ({ ...current, [criterionId]: String(Math.round(criterion.weight * 100)) }));
    setSwingMessage("锚点已改变；摆幅点数已回到该维度当前权重起点，请重新检查后再应用。");
    updateCriterion(criterionId, { [field]: value });
  };

  const setWeight = (criterionId: string, value: number) => updateCriterion(criterionId, { weight: clampPercent(value) / 100 });

  const addCriterion = () => onUpdate({
    criteria: [...draft.criteria, { id: createId(), name: `新评价维度 ${draft.criteria.length + 1}`, description: "", weight: 0, lowAnchor: "较低", highAnchor: "较高" }],
  });

  const removeCriterion = (criterionId: string) => {
    onUpdate({
      criteria: draft.criteria.filter((criterion) => criterion.id !== criterionId),
      scores: draft.scores.filter((score) => score.criterionId !== criterionId),
      workflow: draft.workflow ? {
        ...draft.workflow,
        verificationTasks: draft.workflow.verificationTasks.map((task) => task.criterionId === criterionId
          ? { ...task, criterionId: undefined }
          : task),
      } : undefined,
    });
  };

  const applySwingWeights = () => {
    const rawValues = draft.criteria.map((criterion) => swingValues[criterion.id] ?? "");
    if (rawValues.some((value) => value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0)) {
      setSwingMessage("请为每个维度填写有限的非负改善点数；0 表示不赋予权重。");
      return;
    }
    const values = rawValues.map(Number);
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
      setSwingMessage("至少给一个维度填写大于 0 的相对改善点数。");
      return;
    }
    onUpdate({ criteria: draft.criteria.map((criterion, index) => ({ ...criterion, weight: values[index]! / total })) });
    setSwingMessage(`已按 ${total.toFixed(0)} 个相对点数归一化；仍可手动调整。`);
  };

  return <section className="dj-step-card" aria-labelledby="weights-step-title">
    <div className="dj-step-header"><div><p className="dj-eyebrow">03 / 05 · 价值权衡</p><h2 id="weights-step-title">决定什么更值得你在意</h2><p>权重表达你的注意力分配，不是客观真理。先写清评分锚点，再决定相对重要性。</p></div><span className={`dj-weight-total ${weightTotal === 100 ? "complete" : "warning"}`}>{weightTotal}% / 100%</span></div>
    <div className="dj-criteria-list">
      {draft.criteria.map((criterion) => <article className="dj-criterion-card" key={criterion.id}>
        <div className="dj-criterion-main">
          <label className="dj-field"><span className="sr-only">评价维度名称</span><input className="dj-criterion-name" value={criterion.name} onChange={(event) => updateCriterion(criterion.id, { name: event.target.value })} aria-label={`${criterion.name || "评价维度"}名称`} /></label>
          <label className="dj-field"><span className="sr-only">评价维度说明</span><textarea value={criterion.description} onChange={(event) => updateCriterion(criterion.id, { description: event.target.value })} placeholder="这个维度在你的目标中代表什么？" aria-label={`${criterion.name || "评价维度"}说明`} /></label>
          <div className="dj-anchor-grid"><label className="dj-field">1 分代表<input value={criterion.lowAnchor} onChange={(event) => setAnchor(criterion.id, "lowAnchor", event.target.value)} /></label><label className="dj-field">10 分代表<input value={criterion.highAnchor} onChange={(event) => setAnchor(criterion.id, "highAnchor", event.target.value)} /></label></div>
          {changedAnchorIds.has(criterion.id) && <p className="dj-warning-text">评分锚点已改变，请重新检查已有评分与权重。</p>}
        </div>
        <div className="dj-criterion-weight"><label className="dj-field">相对权重<input type="range" min="0" max="100" step="1" value={Math.round(criterion.weight * 100)} onChange={(event) => setWeight(criterion.id, Number(event.target.value))} aria-label={`${criterion.name || "评价维度"}权重`} /></label><div className="dj-number-input"><input type="number" min="0" max="100" value={Math.round(criterion.weight * 100)} onChange={(event) => setWeight(criterion.id, Number(event.target.value))} aria-label={`${criterion.name || "评价维度"}权重百分比`} /><span>%</span></div><button type="button" className="dj-link-button danger" onClick={() => removeCriterion(criterion.id)}>删除维度</button></div>
      </article>)}
    </div>
    <button type="button" className="dj-add-button" onClick={addCriterion}>＋ 添加一个评价维度</button>

    <section className="dj-swing-helper" aria-labelledby="swing-helper-title">
      <div><p className="dj-eyebrow">可选助手 · 摆幅赋权</p><h3 id="swing-helper-title">先比较“从低到高的改善”有多重要</h3><p>为每个维度输入相对改善点数，点击应用后才会归一化为 100%。这些点数是你的判断起点，不会被当作客观权重。</p></div>
      <div className="dj-swing-grid">{draft.criteria.map((criterion) => <label className="dj-field" key={criterion.id}>{criterion.name || "未命名维度"}<span className="dj-help">{criterion.lowAnchor || "1 分状态"} → {criterion.highAnchor || "10 分状态"}</span><input type="number" min="0" step="1" value={swingValues[criterion.id] ?? ""} onChange={(event) => { setSwingValues((current) => ({ ...current, [criterion.id]: event.target.value })); setSwingMessage(""); }} aria-label={`${criterion.name || "评价维度"}改善相对点数`} /></label>)}</div>
      <div className="dj-swing-actions"><button type="button" className="dj-secondary-button" onClick={applySwingWeights} disabled={draft.criteria.length === 0}>应用并归一化</button>{swingMessage && <span className="dj-help" role="status">{swingMessage}</span>}</div>
    </section>

    <div className="dj-advanced-explainer"><strong>当前比较范围</strong><span>情景与概率、风险偏好、时间价值 / 折现、维度内因素目前未参与基础排名。相关假设可以先写进验证任务。</span></div>
    <div className="dj-note"><strong>合计必须为 100%</strong><span>零权重维度会在评分步骤跳过。改变锚点后请重新审视分数，避免把旧尺度直接沿用。</span></div>
  </section>;
}

export function ScoresStep(props: DecisionStepProps) {
  return props.draft.advancedUiExpanded ? <ProfessionalScoresStep {...props} /> : <SimpleScoresStep {...props} />;
}

function ProfessionalScoresStep({ draft, onUpdate }: DecisionStepProps) {
  const enabledCriteria = useMemo(() => draft.criteria.filter((criterion) => criterion.weight > 0), [draft.criteria]);
  const eligibleOptions = useMemo(() => draft.options.filter((option) => statusForOption(draft, option.id) !== "infeasible"), [draft]);
  const totalScores = enabledCriteria.length * eligibleOptions.length;
  const completedScores = enabledCriteria.reduce((count, criterion) => count + eligibleOptions.filter((option) => {
    const value = draft.scores.find((score) => score.optionId === option.id && score.criterionId === criterion.id)?.value;
    return value !== null && value !== undefined && value >= 1 && value <= 10;
  }).length, 0);

  const upsertScore = (optionId: string, criterionId: string, change: Partial<Score>) => {
    const existing = draft.scores.some((score) => score.optionId === optionId && score.criterionId === criterionId);
    const scores = existing
      ? draft.scores.map((score) => score.optionId === optionId && score.criterionId === criterionId ? { ...score, ...change } : score)
      : [...draft.scores, { optionId, criterionId, value: null, evidence: "", ...change }];
    onUpdate({ scores });
  };

  const setScore = (optionId: string, criterionId: string, rawValue: string) => {
    const value = rawValue === "" ? null : Number(rawValue);
    if (value === null || (Number.isFinite(value) && value >= 1 && value <= 10)) upsertScore(optionId, criterionId, { value });
  };

  return <section className="dj-step-card dj-score-step" aria-labelledby="scores-step-title">
    <div className="dj-step-header"><div><p className="dj-eyebrow">04 / 05 · 证据评分</p><h2 id="scores-step-title">一次比较一个维度</h2><p>评分是偏好强度，不是概率。把事实、假设和估计分开，信心标签只帮助复查，不会偷偷改变分数。</p></div><span className="dj-score-progress">{completedScores} / {totalScores || 0}</span></div>
    {enabledCriteria.length === 0 && <p className="dj-empty">目前没有正权重维度。回到上一步，为至少一个维度分配权重。</p>}
    <div className="dj-score-groups">
      {draft.criteria.map((criterion) => <section className={`dj-score-group ${criterion.weight <= 0 ? "disabled" : ""}`} key={criterion.id}>
        <header><div><strong>{criterion.name || "未命名维度"}</strong><span>{criterion.description || "补充这个维度在你的选择中代表什么。"}</span></div><div className="dj-anchor-pair"><span>1：{criterion.lowAnchor || "较低"}</span><span>10：{criterion.highAnchor || "较高"}</span></div></header>
        {criterion.weight <= 0 ? <p className="dj-skip-note">此维度权重为 0%，已跳过评分。</p> : <div className="dj-score-options">{draft.options.map((option, optionIndex) => {
          const status = statusForOption(draft, option.id);
          const score = draft.scores.find((item) => item.optionId === option.id && item.criterionId === criterion.id);
          const disabled = status === "infeasible";
          return <article className={`dj-score-option ${disabled ? "disabled" : ""}`} key={option.id}>
            <div className="dj-score-option-head"><strong>{optionLabel(option.name, optionIndex)}</strong>{option.isStatusQuo && <span className="dj-status-pill">现状</span>}<span className={`dj-constraint-pill ${status}`}>{statusText[status]}</span></div>
            {disabled ? <p className="dj-skip-note">该方案至少违反一条硬约束，已跳过评分。</p> : <>
              {status === "unknown" && <p className="dj-unknown-note">有约束仍未知；可以暂时评分，但结果会要求先验证。</p>}
              <div className="dj-score-input-line"><label className="sr-only" htmlFor={`score-${criterion.id}-${option.id}`}>{optionLabel(option.name, optionIndex)}在{criterion.name}上的评分</label><input id={`score-${criterion.id}-${option.id}`} type="number" min="1" max="10" value={score?.value ?? ""} onChange={(event) => setScore(option.id, criterion.id, event.target.value)} placeholder="—" /><span>/ 10</span></div>
              <label className="dj-field">评分依据（可选）<textarea value={score?.evidence ?? ""} onChange={(event) => upsertScore(option.id, criterion.id, { evidence: event.target.value })} placeholder="为什么给这个分数？" /></label>
              <div className="dj-evidence-grid"><label className="dj-field">类型<select value={score?.evidenceKind ?? ""} onChange={(event) => upsertScore(option.id, criterion.id, { evidenceKind: event.target.value ? event.target.value as EvidenceKind : undefined })}><option value="">未标注</option><option value="fact">事实</option><option value="assumption">假设</option><option value="estimate">估计</option></select></label><label className="dj-field">信心<select value={score?.evidenceConfidence ?? ""} onChange={(event) => upsertScore(option.id, criterion.id, { evidenceConfidence: event.target.value ? event.target.value as EvidenceConfidence : undefined })}><option value="">未标注</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label><label className="dj-field">日期<input type="date" value={score?.evidenceDate ?? ""} onChange={(event) => upsertScore(option.id, criterion.id, { evidenceDate: event.target.value || undefined })} /></label><label className="dj-field">来源（可选）<input value={score?.evidenceSource ?? ""} onChange={(event) => upsertScore(option.id, criterion.id, { evidenceSource: event.target.value || undefined })} placeholder="链接、文件或联系人" /></label></div>
              <p className="dj-confidence-note">信心标签只用于后续复查，不会改变这个分数。</p>
            </>}
          </article>;
        })}</div>}
      </section>)}
    </div>
    <div className="dj-note dj-note-warm"><strong>沉没成本提醒</strong><span>已经发生且无法收回的投入不应进入未来评分。记录它是为了识别它，不是继续给某个方案加分。</span></div>
  </section>;
}

type RelativeContribution = {
  criterionId: string;
  criterionName: string;
  score: number;
  weightedContribution: number;
  alternativeScore: number;
  weightedDifference: number;
};

type ExtendedEvaluationRow = EvaluationResult["rows"][number] & { relativeContributions?: RelativeContribution[] };
type ExtendedEvaluationResult = EvaluationResult & {
  stabilityDescription?: string;
  tiedFirstOptionIds?: string[];
  pendingConstraintOptionIds?: string[];
};

/** Results stay descriptive: a weighted comparison score is not a probability or a promise. */
export function ResultPanel({ draft, result, onSaveSnapshot, onReview }: { draft: Decision; result: EvaluationResult; onSaveSnapshot: (id: string) => Promise<void>; onReview?: () => void }) {
  const extendedResult = result as ExtendedEvaluationResult;
  const rows = result.rows as ExtendedEvaluationRow[];
  const firstRow = rows.find((row) => row.rank === 1) ?? rows[0];
  const tiedFirstIds = new Set([
    ...rows.filter((row) => row.rank === 1).map((row) => row.optionId),
    ...(extendedResult.tiedFirstOptionIds ?? []),
  ]);
  const pendingIds = new Set(extendedResult.pendingConstraintOptionIds ?? draft.options.filter((option) => statusForOption(draft, option.id) === "unknown").map((option) => option.id));
  const verifiedRows = rows.filter((row) => statusForOption(draft, row.optionId) === "feasible" && !pendingIds.has(row.optionId));
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [snapshotState, setSnapshotState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [snapshotMessage, setSnapshotMessage] = useState("");

  useEffect(() => {
    if (draft.status === "draft") {
      setSnapshotState((current) => current === "saving" ? current : "idle");
      setSnapshotMessage("");
    }
  }, [draft.id, draft.status, draft.updatedAt]);

  useEffect(() => {
    setSelectedOptionId((current) => {
      if (current && verifiedRows.some((row) => row.optionId === current)) return current;
      if (draft.chosenOptionId && verifiedRows.some((row) => row.optionId === draft.chosenOptionId)) return draft.chosenOptionId;
      return verifiedRows[0]?.optionId ?? "";
    });
  }, [draft.chosenOptionId, verifiedRows.map((row) => row.optionId).join("|")]);

  const alternativeRow = firstRow?.bestForegoneOptionId ? rows.find((row) => row.optionId === firstRow.bestForegoneOptionId) : undefined;
  const alternativeName = alternativeRow ? (draft.options.find((option) => option.id === alternativeRow.optionId)?.name || "最佳替代") : "暂无";
  const firstName = firstRow ? (draft.options.find((option) => option.id === firstRow.optionId)?.name || "未命名方案") : "暂无";
  const utilityRange = rows.length > 0 ? `${Math.min(...rows.map((row) => row.utility)).toFixed(2)} – ${Math.max(...rows.map((row) => row.utility)).toFixed(2)}` : "—";
  const relative = firstRow?.relativeContributions ?? [];

  const saveSelectedSnapshot = async () => {
    if (snapshotState === "saving" || !verifiedRows.some((row) => row.optionId === selectedOptionId)) return;
    setSnapshotState("saving");
    setSnapshotMessage("");
    try {
      await onSaveSnapshot(selectedOptionId);
      setSnapshotState("saved");
      setSnapshotMessage("决策快照已保存。");
    } catch (error) {
      setSnapshotState("error");
      setSnapshotMessage(error instanceof Error ? error.message : "快照保存失败，请重试。");
    }
  };

  return <div className="dj-result-layout">
    <section className="dj-result-hero"><div><p className="dj-eyebrow">评估结果 · {result.calculationVersion}</p><h1>{result.ready ? "把选择交还给你。" : "先补齐几个关键输入。"}</h1><p>{result.ready ? "这是在当前权重、锚点和评分下的加权比较分，不是概率，也不保证未来结果。" : result.errors.join(" ")}</p></div>{result.ready && <div className={`dj-stability ${result.stability}`}><span />{result.stability === "stable" ? "排序相对稳定" : result.stability === "sensitive" ? "排序对权重敏感" : "信息还不完整"}<small>{extendedResult.stabilityDescription ?? `当前综合效用范围：${utilityRange}`}</small></div>}</section>
    {result.ready && firstRow ? <>
      <section className="dj-panel dj-ranking-panel"><div className="dj-panel-heading"><div><p className="dj-eyebrow">综合效用排序</p><h2>在当前假设下，方案如何比较？</h2></div><span className="dj-muted">比较分 · 满分 10</span></div><div className="dj-ranking-list">{rows.map((row) => { const option = draft.options.find((item) => item.id === row.optionId); const isFirst = tiedFirstIds.has(row.optionId); const pending = pendingIds.has(row.optionId); return <div className={`dj-ranking-row ${isFirst ? "winner" : ""}`} key={row.optionId}><span className="dj-rank-number">{String(row.rank).padStart(2, "0")}</span><div className="dj-rank-main"><div className="dj-rank-title"><strong>{option?.name || "未命名方案"}</strong>{isFirst && <span className="dj-recommended">当前最高</span>}{pending && <span className="dj-pending">待验证</span>}</div><div className="dj-utility-bar"><span style={{ width: `${Math.max(0, Math.min(100, row.utility * 10))}%` }} /></div><div className="dj-rank-meta"><span>综合效用 {row.utility.toFixed(2)} / 10</span>{pending && <span>存在未知硬约束</span>}</div></div><strong className="dj-rank-score">{row.utility.toFixed(2)}</strong></div>; })}</div><p className="dj-result-caption">机会成本会单独显示为“放弃的最佳替代”，不会从综合效用再次扣分。</p></section>

      {relative.length > 0 && alternativeRow && <section className="dj-panel dj-contribution-panel"><div className="dj-panel-heading"><div><p className="dj-eyebrow">第一名 vs 最佳替代</p><h2>{firstName} 相对 {alternativeName} 的贡献差异</h2></div></div><div className="dj-contribution-table"><div className="dj-contribution-head"><span>评价维度</span><span>{firstName}</span><span>{alternativeName}</span><span>加权差异</span></div>{relative.map((item) => <div className="dj-contribution-row" key={item.criterionId}><span>{item.criterionName}</span><span>{item.score.toFixed(2)} · {item.weightedContribution.toFixed(2)}</span><span>{item.alternativeScore.toFixed(2)}</span><strong className={item.weightedDifference >= 0 ? "positive" : "negative"}>{item.weightedDifference >= 0 ? "+" : ""}{item.weightedDifference.toFixed(2)}</strong></div>)}</div></section>}

      <section className="dj-result-grid"><div className="dj-panel"><div className="dj-panel-heading"><div><p className="dj-eyebrow">为什么会是这个排序？</p><h2>最有影响力的因素</h2></div></div><div className="dj-insight-list">{result.decisiveCriteria.map((criterion) => <div className="dj-insight" key={criterion}><span /> <div><strong>{criterion}</strong><small>权重与方案差异共同放大了它的影响</small></div></div>)}</div><div className="dj-net-advantage"><span>第一名相对次优方案的净优势</span><strong>{firstRow.netAdvantageOverNextBest === undefined ? "—" : `${firstRow.netAdvantageOverNextBest >= 0 ? "+" : ""}${firstRow.netAdvantageOverNextBest.toFixed(2)}`}</strong></div><div className="dj-sensitivity"><span>敏感性范围 / 说明</span><strong>{extendedResult.stabilityDescription ?? `当前方案比较分跨度 ${utilityRange}`}</strong></div>{tiedFirstIds.size > 1 && <p className="dj-warning-text">当前存在并列第一：{[...tiedFirstIds].map((id) => draft.options.find((option) => option.id === id)?.name || "未命名").join("、")}。</p>}</div>
        <div className="dj-panel dj-opportunity"><div className="dj-panel-heading"><div><p className="dj-eyebrow">被放弃的价值</p><h2>机会成本</h2></div><span className="dj-tag">不重复扣分</span></div><p>如果选择 <strong>{firstName}</strong>，当前模型认为你放弃的最佳可行替代是：</p><div className="dj-foregone"><strong>{alternativeName}</strong><span>效用 {firstRow.bestForegoneUtility?.toFixed(2) ?? "—"}</span></div><p className="dj-help">机会成本是帮助你看见取舍的比较提示，不是要从第一名的分数再扣一次。</p></div></section>

      <section className="dj-result-grid"><div className="dj-panel"><div className="dj-panel-heading"><div><p className="dj-eyebrow">模型旁白</p><h2>值得带走的提醒</h2></div></div>{result.notices.map((notice, index) => <div className="dj-notice" key={`${notice.concept}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{notice.title}</strong><p>{notice.body}</p></div></div>)}{pendingIds.size > 0 && <div className="dj-notice dj-notice-warning"><span>!</span><div><strong>仍有方案等待硬约束验证</strong><p>{[...pendingIds].map((id) => draft.options.find((option) => option.id === id)?.name || "未命名方案").join("、")}</p></div></div>}</div>
        <div className="dj-panel dj-snapshot">
          <div className="dj-panel-heading"><div><p className="dj-eyebrow">确认你的选择</p><h2>保存一张决策快照</h2></div></div>
          <p>快照只允许选择全部硬约束都标记为“已满足”的方案，并会封存当前输入与计算版本。</p>
          <label className="dj-field">我最终选择
            <select value={selectedOptionId} onChange={(event) => { setSelectedOptionId(event.target.value); setSnapshotState("idle"); setSnapshotMessage(""); }} disabled={verifiedRows.length === 0 || snapshotState === "saving"}>
              <option value="">请选择已核实方案</option>
              {verifiedRows.map((row) => <option value={row.optionId} key={row.optionId}>{draft.options.find((option) => option.id === row.optionId)?.name || "未命名方案"}</option>)}
            </select>
          </label>
          {verifiedRows.length === 0 && <p className="dj-warning-text">目前没有可直接确认的方案：请把未知约束验证为“已满足”。</p>}
          <button type="button" className="dj-primary-button" disabled={!selectedOptionId || snapshotState === "saving"} onClick={() => void saveSelectedSnapshot()}>{snapshotState === "saving" ? "正在保存快照…" : draft.status === "decided" ? "再次保存快照" : "确认并保存快照"} <span>→</span></button>
          {snapshotMessage && <p className={snapshotState === "error" ? "dj-warning-text" : "dj-snapshot-status"} role={snapshotState === "error" ? "alert" : "status"}>{snapshotMessage}</p>}
          {onReview && <button type="button" className="dj-link-button" onClick={onReview}>继续行动与复盘 →</button>}
        </div>
      </section>
    </> : <div className="dj-empty-result"><span>◎</span><strong>完成评分后，这里会出现可解释的排序。</strong><p>{result.errors[0] ?? "请先回到前面的步骤补齐信息。"}</p></div>}
  </div>;
}
