import type { DecisionStepProps } from "./DecisionSteps";
import type { Score } from "../domain/types";
import "./simple-comparison.css";

export function SimpleWeightsStep({ draft, onUpdate }: DecisionStepProps) {
  const total = draft.criteria.reduce((sum, item) => sum + item.weight, 0);
  const change = (id: string, values: Partial<typeof draft.criteria[number]>) => onUpdate({ criteria: draft.criteria.map((item) => item.id === id ? { ...item, ...values } : item) });
  const remove = (id: string) => onUpdate({ criteria: draft.criteria.filter((item) => item.id !== id), scores: draft.scores.filter((item) => item.criterionId !== id) });
  return <section className="dj-step-card simple-comparison" aria-label="简洁权重设置">
    <header className="simple-heading"><div><h2>你更在意什么？</h2><p>把 100% 分给这些方面，越在意的占比越高。</p></div><span className="simple-total">合计 {(total * 100).toFixed(1).replace(/\.0$/, "")}%</span></header>
    <div className="simple-criteria">{draft.criteria.map((item) => <article className="simple-criterion" key={item.id}>
      <div className="simple-criterion-top"><label className="dj-field">评价维度<input aria-label={`${item.name || "评价维度"}名称`} value={item.name} onChange={(e) => change(item.id, { name: e.target.value })} /></label>
        <label className="dj-field simple-weight">权重（%）<input aria-label={`${item.name || "评价维度"}权重百分比`} type="number" min="0" max="100" step="any" value={Number((item.weight * 100).toFixed(4))} onChange={(e) => { const value = Number(e.target.value); if (Number.isFinite(value) && value >= 0 && value <= 100) change(item.id, { weight: value / 100 }); }} /></label>
        <button className="dj-icon-button" type="button" aria-label={`删除${item.name || "评价维度"}`} onClick={() => remove(item.id)}>×</button></div>
      <label className="dj-field">备注描述（可选）<textarea aria-label={`${item.name || "评价维度"}备注`} placeholder="这个方面对你意味着什么？" value={item.description} onChange={(e) => change(item.id, { description: e.target.value })} /></label>
    </article>)}</div>
    <div className="simple-actions"><button className="dj-secondary-button" type="button" onClick={() => onUpdate({ criteria: [...draft.criteria, { id: crypto.randomUUID(), name: `评价维度 ${draft.criteria.length + 1}`, description: "", weight: draft.criteria.length ? 0 : 1, lowAnchor: "很不符合期待", highAnchor: "非常符合期待" }] })}>＋ 添加评价维度</button>
      <button className="dj-secondary-button" type="button" disabled={!Number.isFinite(total) || total <= 0} onClick={() => onUpdate({ criteria: draft.criteria.map((item) => ({ ...item, weight: item.weight / total })) })}>按比例调整到 100%</button></div>
  </section>;
}

export function SimpleScoresStep({ draft, onUpdate }: DecisionStepProps) {
  const criteria = draft.criteria.filter((item) => item.weight > 0);
  const options = draft.options.filter((option) => draft.constraints.every((item) => item.evaluations[option.id] !== "infeasible"));
  const update = (optionId: string, criterionId: string, change: Partial<Score>) => {
    const exists = draft.scores.some((item) => item.optionId === optionId && item.criterionId === criterionId);
    onUpdate({ scores: exists ? draft.scores.map((item) => item.optionId === optionId && item.criterionId === criterionId ? { ...item, ...change } : item) : [...draft.scores, { optionId, criterionId, value: null, evidence: "", ...change }] });
  };
  return <section className="dj-step-card simple-comparison" aria-label="简洁评分">
    <header className="simple-heading"><div><h2>每个方案有多符合期待？</h2><p>同一方面横向比较：1 分很不符合，10 分非常符合。拿不准可以先留空。</p></div></header>
    {criteria.length === 0 && <p>先设置至少一个大于 0 的权重。</p>}
    {options.length < draft.options.length && <p className="dj-help">不满足底线的方案已跳过评分。</p>}
    <div className="simple-score-groups">{criteria.map((criterion) => <section className="simple-score-group" key={criterion.id}>
      <header><strong>{criterion.name || "未命名维度"}</strong><span>权重 {Number((criterion.weight * 100).toFixed(1))}%</span></header>
      {criterion.description && <p className="simple-note">{criterion.description}</p>}
      <div className="simple-score-options">{options.map((option) => {
        const score = draft.scores.find((item) => item.optionId === option.id && item.criterionId === criterion.id);
        return <article key={option.id} className="simple-score-option"><div className="simple-score-top"><strong>{option.name || "未命名方案"}</strong><label className="dj-field">评分（1–10）<input type="number" min="1" max="10" step="any" aria-label={`${option.name}在${criterion.name}上的评分`} value={score?.value ?? ""} onChange={(e) => { const value = e.target.value === "" ? null : Number(e.target.value); if (value === null || Number.isFinite(value) && value >= 1 && value <= 10) update(option.id, criterion.id, { value }); }} /></label></div>
          <label className="dj-field">备注描述（可选）<textarea aria-label={`${option.name}在${criterion.name}上的备注`} value={score?.evidence ?? ""} placeholder="为什么这样打分？" onChange={(e) => update(option.id, criterion.id, { evidence: e.target.value })} /></label>
        </article>;
      })}</div>
    </section>)}</div>
  </section>;
}
