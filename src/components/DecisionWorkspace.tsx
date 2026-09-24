import { useState } from "react";
import type { Decision } from "../domain/types";
import {
  appendReview,
  brierScore,
  boundaryExceeded,
  emptyWorkflow,
  investmentTotals,
  isPredictionDue,
  localDate,
  sealPrediction,
  settlePrediction,
  validateWorkflowTransition,
  type ActionPlan,
  type DecisionReview,
  type DecisionWorkflow,
  type InvestmentBoundary,
  type InvestmentRecord,
  type Prediction,
  type VerificationTask,
} from "../domain/workflow";
import "./workspace.css";

export type DecisionWorkspaceProps = {
  decision: Decision;
  section: "evidence" | "review";
  onChange: (workflow: DecisionWorkflow) => boolean | void;
};

type WorkflowPatch = (change: Partial<DecisionWorkflow>) => boolean;

const uid = () => globalThis.crypto?.randomUUID?.() ?? `workflow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const today = () => localDate();
const blankTask = (): VerificationTask => ({ id: uid(), optionId: undefined, criterionId: undefined, hypothesis: "", decisionImpact: "", method: "", source: "", costAmount: null, costUnit: "CNY", dueDate: "", status: "open", finding: "", updatedAt: new Date().toISOString() });
const blankInvestment = (): InvestmentRecord => ({ id: uid(), label: "", kind: "actual", amount: null, currency: "CNY", hours: null, note: "", recordedAt: today() });
const blankPrediction = (): Prediction => ({ id: uid(), statement: "", probability: null, outcome: null, dueDate: "", evidence: "", basis: "", outcomeEvidence: "", createdAt: new Date().toISOString() });
const blankReview = (): DecisionReview => ({ id: uid(), date: today(), judgment: "", execution: "", externalChange: "", nextStep: "" });
const initialPlan: ActionPlan = { trigger: "", action: "", when: "", where: "", obstacle: "", fallback: "", reviewDate: "" };

export function DecisionWorkspace({ decision, section, onChange }: DecisionWorkspaceProps) {
  const [error, setError] = useState("");
  const workflow = decision.workflow ?? emptyWorkflow();
  const patch: WorkflowPatch = (change) => {
    const next = { ...workflow, ...change };
    const validation = validateWorkflowTransition(workflow, next);
    if (!validation.valid) { setError(validation.errors.join("；")); return false; }
    try {
      if (onChange(next) === false) { setError("保存未完成，已保留原始内容。请查看页面提示后重试。"); return false; }
      setError("");
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请重试"); return false; }
  };
  return <>{section === "evidence"
    ? <EvidenceWorkspace decision={decision} workflow={workflow} patch={patch} />
    : <ReviewWorkspace workflow={workflow} patch={patch} />}
    {error && <p className="workspace-alert" role="alert">{error}</p>}
  </>;
}

function EvidenceWorkspace({ decision, workflow, patch }: { decision: Decision; workflow: DecisionWorkflow; patch: WorkflowPatch }) {
  const updateTask = (id: string, change: Partial<VerificationTask>) => patch({ verificationTasks: workflow.verificationTasks.map((task) => task.id === id ? { ...task, ...change, updatedAt: new Date().toISOString() } : task) });
  const updateInvestment = (id: string, change: Partial<InvestmentRecord>) => patch({ investments: workflow.investments.map((item) => item.id === id ? { ...item, ...change } : item) });
  const totals = investmentTotals(workflow.investments, workflow.investmentBoundary);
  const boundary = workflow.investmentBoundary ?? { amount: totals.boundaryAmountConfigured ? totals.boundaryAmount : null, hours: totals.boundaryHoursConfigured ? totals.boundaryHours : null };
  const options = decision.options;
  const criteria = decision.criteria;
  const saveBoundary = (change: Partial<InvestmentBoundary>) => patch({ investmentBoundary: { ...boundary, ...change }, investments: workflow.investments.filter((item) => item.kind !== "boundary") });

  return <section className="decision-workspace" aria-label="证据与投入工作区">
    <header className="workspace-heading">
      <div><span className="workspace-kicker">01 / evidence</span><h2>验证未知，控制投入</h2><p>把会改变选择的假设写成可执行的验证任务。定性信息价值只提示优先级，不自动计入分数。</p></div>
      <a href="https://doi.org/10.1109/TSSC.1966.300074" target="_blank" rel="noreferrer">信息价值理论 DOI ↗</a>
    </header>
    <div className="workspace-stack">
      <details className="workspace-card" open>
        <summary><strong>验证任务</strong><span>假设 → 影响 → 方法 → 结果</span></summary>
        <p className="workspace-note">只为会改变方案排序或行动门槛的未知安排验证；人民币和小时分开记录。</p>
        {workflow.verificationTasks.map((task) => <article className="workspace-item" key={task.id}>
          <div className="workspace-item-head"><strong>{task.hypothesis || "未命名假设"}</strong><button type="button" className="workspace-link danger-link" onClick={() => patch({ verificationTasks: workflow.verificationTasks.filter((item) => item.id !== task.id) })}>移除</button></div>
          <div className="workspace-grid two">
            <label>绑定方案<select aria-label="绑定方案" value={task.optionId ?? ""} onChange={(e) => updateTask(task.id, { optionId: e.target.value || undefined })}><option value="">未绑定</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
            <label>绑定标准<select aria-label="绑定标准" value={task.criterionId ?? ""} onChange={(e) => updateTask(task.id, { criterionId: e.target.value || undefined })}><option value="">未绑定</option>{criteria.map((criterion) => <option key={criterion.id} value={criterion.id}>{criterion.name}</option>)}</select></label>
          </div>
          <label>假设<textarea aria-label="假设" value={task.hypothesis} onChange={(e) => updateTask(task.id, { hypothesis: e.target.value })} placeholder="如果获得何种信息，哪个选择会改变？" /></label>
          <label>何种答案会改变决定<textarea aria-label="何种答案会改变决定" value={task.decisionImpact} onChange={(e) => updateTask(task.id, { decisionImpact: e.target.value })} /></label>
          <div className="workspace-grid two"><label>验证方法<textarea aria-label="验证方法" value={task.method} onChange={(e) => updateTask(task.id, { method: e.target.value })} /></label><label>来源（可放 DOI 链接）<textarea aria-label="来源" value={task.source} onChange={(e) => updateTask(task.id, { source: e.target.value })} /></label></div>
          <div className="workspace-grid four"><label>成本<input aria-label="验证成本" type="number" min="0" step="0.01" value={task.costAmount ?? ""} onChange={(e) => updateTask(task.id, { costAmount: e.target.value === "" ? null : Number(e.target.value) })} /></label><label>单位<select aria-label="验证成本单位" value={task.costUnit} onChange={(e) => updateTask(task.id, { costUnit: e.target.value as VerificationTask["costUnit"] })}><option value="CNY">人民币</option><option value="hour">小时</option><option value="other" disabled>其他（旧数据）</option></select></label><label>截止<input aria-label="验证截止日期" type="date" value={task.dueDate} onChange={(e) => updateTask(task.id, { dueDate: e.target.value })} /></label><label>状态<select aria-label="验证状态" value={task.status} onChange={(e) => updateTask(task.id, { status: e.target.value as VerificationTask["status"] })}><option value="open">待验证</option><option value="in_progress">进行中</option><option value="verified">已验证</option><option value="discarded">放弃</option></select></label></div>
          <label>验证结果<textarea aria-label="验证结果" value={task.finding} onChange={(e) => updateTask(task.id, { finding: e.target.value })} placeholder="完成后单独记录观察到的事实" /></label>
          {task.dueDate && task.dueDate <= today() && (task.status === "open" || task.status === "in_progress") && <p className="workspace-alert">验证任务已到期，请记录结果或调整验证安排。</p>}
        </article>)}
        {workflow.verificationTasks.length === 0 && <p className="workspace-empty">还没有验证任务。先添加一个最可能改变决定的未知。</p>}
        <button type="button" className="workspace-button" onClick={() => patch({ verificationTasks: [...workflow.verificationTasks, blankTask()] })}>＋ 添加验证任务</button>
      </details>

      <details className="workspace-card" open>
        <summary><strong>投入与边界</strong><span>钱、时间、可回收金额分别看</span></summary>
        <div className="boundary-grid"><label>金额边界（CNY）<input aria-label="金额边界" type="number" min="0" step="0.01" value={boundary.amount ?? ""} onChange={(e) => saveBoundary({ amount: e.target.value === "" ? null : Number(e.target.value) })} /></label><label>小时边界<input aria-label="小时边界" type="number" min="0" step="0.25" value={boundary.hours ?? ""} onChange={(e) => saveBoundary({ hours: e.target.value === "" ? null : Number(e.target.value) })} /></label></div>
        <p className={boundaryExceeded(workflow.investments, workflow.investmentBoundary) ? "workspace-alert" : "workspace-note"}>{boundaryExceeded(workflow.investments, workflow.investmentBoundary) ? "已达到投入边界，建议立即复评决定。" : "达到边界（含恰好相等）即触发复评；零边界也是有效边界。"}</p>
        {workflow.investments.filter((item) => item.kind !== "boundary").map((item) => <article className="workspace-item compact-item" key={item.id}>
          <div className="workspace-grid four"><label>名称<input aria-label="投入名称" value={item.label} onChange={(e) => updateInvestment(item.id, { label: e.target.value })} /></label><label>类别<select aria-label="投入类别" value={item.kind} onChange={(e) => updateInvestment(item.id, { kind: e.target.value as InvestmentRecord["kind"], ...(e.target.value === "recoverable" ? { hours: null } : {}) })}><option value="planned">计划</option><option value="actual">实际</option><option value="recoverable">可回收</option></select></label><label>金额（CNY）<input aria-label="投入金额" type="number" min="0" step="0.01" value={item.amount ?? ""} onChange={(e) => updateInvestment(item.id, { amount: e.target.value === "" ? null : Number(e.target.value) })} /></label><label>小时<input aria-label="投入小时" disabled={item.kind === "recoverable"} type="number" min="0" step="0.25" value={item.hours ?? ""} onChange={(e) => updateInvestment(item.id, { hours: e.target.value === "" ? null : Number(e.target.value) })} /></label></div>
          <div className="workspace-item-foot"><input aria-label="投入备注" value={item.note} onChange={(e) => updateInvestment(item.id, { note: e.target.value })} placeholder="备注" /><button type="button" className="workspace-link danger-link" onClick={() => patch({ investments: workflow.investments.filter((entry) => entry.id !== item.id) })}>移除</button></div>
        </article>)}
        <button type="button" className="workspace-button" onClick={() => patch({ investments: [...workflow.investments, blankInvestment()] })}>＋ 添加投入记录</button>
        <div className="workspace-totals"><span>实际 ¥{totals.actualAmount.toFixed(2)} / {totals.actualHours} 小时</span><span>可回收 ¥{totals.recoverableAmount.toFixed(2)} · 仅金额可回收</span></div>
        <p className="workspace-note">计划 ¥{totals.plannedAmount.toFixed(2)} / {totals.plannedHours} 小时。可回收金额的累计值不能超过实际支出。</p>
      </details>
    </div>
    <p className="workspace-source">多属性权重可参考 <a href="https://doi.org/10.1006/obhd.1994.1087" target="_blank" rel="noreferrer">SMARTS / SMARTER DOI ↗</a>；这里的验证优先级不会自动改变评分。</p>
  </section>;
}

function ReviewWorkspace({ workflow, patch }: { workflow: DecisionWorkflow; patch: WorkflowPatch }) {
  const [error, setError] = useState("");
  const plan = workflow.actionPlan ?? initialPlan;
  const updatePlan = (change: Partial<ActionPlan>) => patch({ actionPlan: { ...plan, ...change } });
  const updatePrediction = (id: string, change: Partial<Prediction>) => patch({ predictions: workflow.predictions.map((item) => item.id === id && !item.sealedAt ? { ...item, ...change } : item) });
  const reviewDraft = workflow.reviewDraft ?? blankReview();
  const setReviewDraft = (draft: DecisionReview) => patch({ reviewDraft: draft });
  const updateOutcomeEvidence = (id: string, outcomeEvidence: string) => patch({ predictions: workflow.predictions.map((item) => item.id === id && item.sealedAt && item.outcome === null ? { ...item, outcomeEvidence } : item) });
  const updatePredictionSafely = (prediction: Prediction) => {
    try { if (patch({ predictions: workflow.predictions.map((item) => item.id === prediction.id ? sealPrediction(item) : item) })) setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法封存预测"); }
  };
  const score = brierScore(workflow.predictions);
  return <section className="decision-workspace" aria-label="行动与复盘工作区">
    <header className="workspace-heading"><div><span className="workspace-kicker">02 / review</span><h2>把选择变成可观察的行动</h2><p>如果—那么计划连接触发条件和动作；预测先封存，再等截止日期后记录结果。</p></div><a href="https://doi.org/10.1037/0003-066X.54.7.493" target="_blank" rel="noreferrer">实施意图 DOI ↗</a></header>
    <div className="workspace-stack">
      <details className="workspace-card" open><summary><strong>如果—那么行动计划</strong><span>触发、行动、障碍、替代方案、到期提示</span></summary>
        <div className="workspace-grid two"><label>如果（触发条件）<textarea aria-label="触发条件" value={plan.trigger} onChange={(e) => updatePlan({ trigger: e.target.value })} /></label><label>那么（具体行动）<textarea aria-label="具体行动" value={plan.action} onChange={(e) => updatePlan({ action: e.target.value })} /></label><label>何时执行<input aria-label="行动时间" value={plan.when} onChange={(e) => updatePlan({ when: e.target.value })} /></label><label>在哪里/与谁<input aria-label="行动地点或对象" value={plan.where} onChange={(e) => updatePlan({ where: e.target.value })} /></label><label>预期障碍<textarea aria-label="预期障碍" value={plan.obstacle} onChange={(e) => updatePlan({ obstacle: e.target.value })} /></label><label>替代方案<textarea aria-label="替代方案" value={plan.fallback} onChange={(e) => updatePlan({ fallback: e.target.value })} /></label><label>复评日期<input aria-label="复评日期" type="date" value={plan.reviewDate} onChange={(e) => updatePlan({ reviewDate: e.target.value })} /></label></div>
        {plan.reviewDate && plan.reviewDate <= today() && <p className="workspace-alert">已到计划复评日期，请检查执行情况并追加一次复盘。</p>}
      </details>
      <details className="workspace-card" open><summary><strong>事前预测</strong><span>封存后原始概率不能回写</span></summary>
        <p className="workspace-note">封存会锁定陈述、概率、截止日期和依据。截止日前不能结算；结果证据与事前依据分开保存。</p>
        {workflow.predictions.map((prediction) => <article className="workspace-item" key={prediction.id}>
          <div className="workspace-item-head"><strong>{prediction.sealedAt ? "已封存" : "草稿"}</strong>{!prediction.sealedAt && <button type="button" className="workspace-link danger-link" onClick={() => patch({ predictions: workflow.predictions.filter((item) => item.id !== prediction.id) })}>移除</button>}</div>
          <label>预测陈述<textarea aria-label="预测陈述" disabled={!!prediction.sealedAt} value={prediction.statement} onChange={(e) => updatePrediction(prediction.id, { statement: e.target.value })} /></label>
          <div className="workspace-grid three"><label>概率（0–1）<input aria-label="预测概率" disabled={!!prediction.sealedAt} type="number" min="0" max="1" step="0.01" value={prediction.probability ?? ""} onChange={(e) => updatePrediction(prediction.id, { probability: e.target.value === "" ? null : Number(e.target.value) })} /></label><label>截止日期<input aria-label="预测截止日期" disabled={!!prediction.sealedAt} type="date" value={prediction.dueDate} onChange={(e) => updatePrediction(prediction.id, { dueDate: e.target.value })} /></label><label>封存时间<input aria-label="预测封存时间" disabled value={prediction.sealedAt ?? "未封存"} /></label></div>
          <label>事前依据<textarea aria-label="事前依据" disabled={!!prediction.sealedAt} value={prediction.basis ?? prediction.evidence} onChange={(e) => updatePrediction(prediction.id, { basis: e.target.value, evidence: e.target.value })} /></label>
          {!prediction.sealedAt && <button type="button" className="workspace-button" onClick={() => updatePredictionSafely(prediction)}>封存这条预测</button>}
          {prediction.sealedAt && <>
            <label>结果证据<textarea aria-label="预测结果证据" value={prediction.outcomeEvidence ?? ""} disabled={prediction.outcome !== null} onChange={(e) => updateOutcomeEvidence(prediction.id, e.target.value)} placeholder="可先记录观察证据；截止日结束后才能结算" /></label>
            {prediction.outcome === null && <p className={isPredictionDue(prediction) ? "workspace-alert" : "workspace-note"}>{isPredictionDue(prediction) ? "截止日已结束，可以依据结果证据结算。" : `等待 ${prediction.dueDate} 截止日结束后结算。`}</p>}
            <div className="workspace-settle">
              <label>实际结果<select aria-label="预测是否发生" disabled={prediction.outcome !== null || !isPredictionDue(prediction)} value={prediction.outcome === null ? "" : prediction.outcome ? "yes" : "no"} onChange={(e) => {
                if (e.target.value) {
                  try {
                    const next = settlePrediction(prediction, e.target.value === "yes", prediction.outcomeEvidence ?? "");
                    if (patch({ predictions: workflow.predictions.map((item) => item.id === prediction.id ? next : item) })) setError("");
                  } catch (cause) { setError(cause instanceof Error ? cause.message : "无法结算预测"); }
                }
              }}><option value="">到期后选择结果</option><option value="yes">发生</option><option value="no">未发生</option></select></label>
              {prediction.outcome !== null && <span>已结算 · {prediction.scoredAt ? localDate(new Date(prediction.scoredAt)) : ""}</span>}
            </div>
          </>}
        </article>)}
        {workflow.predictions.length === 0 && <p className="workspace-empty">还没有预测。写下一个可在截止日期检查的二元陈述。</p>}
        <button type="button" className="workspace-button" onClick={() => patch({ predictions: [...workflow.predictions, blankPrediction()] })}>＋ 添加预测草稿</button>
        {score !== undefined && <div className="workspace-totals"><span>已结算预测 Brier {score.toFixed(3)}</span><span>概率预测的平均平方误差；越低越好，不是总体决策质量分</span></div>}
      </details>
      <details className="workspace-card" open><summary><strong>不可变复盘记录</strong><span>判断、执行、外部变化、下一步</span></summary>
        {workflow.reviews.map((review) => <article className="workspace-item compact-item" key={review.id}><div className="workspace-grid two"><label>日期<input aria-label="复盘日期" disabled value={review.date} /></label><label>记录时间<input aria-label="记录创建时间" disabled value={review.createdAt ?? ""} /></label><label>当时判断<textarea aria-label="当时判断" disabled value={review.judgment} /></label><label>执行情况<textarea aria-label="执行情况" disabled value={review.execution} /></label><label>外部变化<textarea aria-label="外部变化" disabled value={review.externalChange} /></label><label>下一步<textarea aria-label="下一步" disabled value={review.nextStep} /></label></div></article>)}
        <article className="workspace-item review-draft">
          <div className="workspace-grid two">
            <label>日期<input aria-label="新复盘日期" type="date" value={reviewDraft.date} onChange={(e) => setReviewDraft({ ...reviewDraft, date: e.target.value })} /></label>
            <label>当时判断<textarea aria-label="新复盘判断" value={reviewDraft.judgment} onChange={(e) => setReviewDraft({ ...reviewDraft, judgment: e.target.value })} /></label>
            <label>执行情况<textarea aria-label="新复盘执行情况" value={reviewDraft.execution} onChange={(e) => setReviewDraft({ ...reviewDraft, execution: e.target.value })} /></label>
            <label>外部变化<textarea aria-label="新复盘外部变化" value={reviewDraft.externalChange} onChange={(e) => setReviewDraft({ ...reviewDraft, externalChange: e.target.value })} /></label>
            <label>下一步<textarea aria-label="新复盘下一步" value={reviewDraft.nextStep} onChange={(e) => setReviewDraft({ ...reviewDraft, nextStep: e.target.value })} /></label>
          </div>
          <button type="button" className="workspace-button" onClick={() => {
            if (!reviewDraft.judgment.trim() && !reviewDraft.execution.trim() && !reviewDraft.externalChange.trim() && !reviewDraft.nextStep.trim()) {
              setError("复盘至少填写一项");
              return;
            }
            try {
              if (patch(appendReview(workflow, reviewDraft))) setError("");
            } catch (cause) { setError(cause instanceof Error ? cause.message : "无法追加复盘"); }
          }}>追加复盘记录</button>
        </article>
      </details>
    </div>
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    <p className="workspace-source"><a href="https://doi.org/10.1037/0022-3514.54.4.569" target="_blank" rel="noreferrer">结果偏差研究 DOI ↗</a>：复盘时把事前判断、执行质量和外部结果分开看。</p>
  </section>;
}

