import { useEffect, useRef, useState } from "react";
import { comparisonFingerprint, promptPresets, proposalChange, type ChatMessage, type DesignProposal } from "../domain/assistant";
import type { Decision } from "../domain/types";
import { requestAssistant } from "../infrastructure/assistantClient";
import { getSessionApiKey, loadAssistantSettings, saveAssistantSettings, setSessionApiKey } from "../infrastructure/assistantSettings";
import "./assistant.css";

type Message = ChatMessage & { display?: string };
type Props = { open: boolean; disabled: boolean; decision: Decision; getDecision: () => Decision; onChange: (change: Partial<Decision>) => boolean; onClose: () => void; onApplied: () => void };

export function DecisionAssistant({ open, disabled, decision, getDecision, onChange, onClose, onApplied }: Props) {
  const [settings, setSettings] = useState(loadAssistantSettings);
  const [apiKey, setApiKey] = useState(getSessionApiKey);
  const [settingsOpen, setSettingsOpen] = useState(!settings.model);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settingsNotice, setSettingsNotice] = useState("");
  const [proposal, setProposal] = useState<DesignProposal | null>(null);
  const [basis, setBasis] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const chatEnd = useRef<HTMLDivElement>(null);
  const stale = !!basis && basis !== comparisonFingerprint(decision);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort(); }; }, []);
  useEffect(() => { if (!open) active.current?.abort(); }, [open]);
  useEffect(() => { if (open && messages.length) chatEnd.current?.scrollIntoView?.({ block: "nearest" }); }, [messages, open]);

  const saveSettings = () => {
    try { saveAssistantSettings(settings); setSessionApiKey(apiKey); setSettingsNotice("配置已保存；密钥仅在当前页面有效。"); setSettingsOpen(false); setError(""); }
    catch { setSettingsNotice(""); setError("浏览器未能保存配置，本次仍可使用当前设置。"); }
  };
  const reset = () => { setMessages([]); setProposal(null); setBasis(""); setConfirmed(false); setError(""); };
  const send = async (text: string) => {
    if (!text.trim() || active.current || disabled) return;
    const current = getDecision();
    const fingerprint = comparisonFingerprint(current);
    if (basis && basis !== fingerprint) { setError("比较内容已修改，请重新开始问答，以新的内容为准。"); return; }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError(""); setConfirmed(false);
    const nextMessages: Message[] = [...messages, { role: "user", content: text.trim() }];
    try {
      const reply = await requestAssistant(settings, apiKey, current, nextMessages.map(({ role, content }) => ({ role, content })), controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setMessages([...nextMessages, { role: "assistant", content: reply.content, display: reply.message }]);
      setInput(""); setBasis(fingerprint); setProposal(reply.proposal);
    } catch (cause) {
      if (mounted.current) { setError(cause instanceof Error ? cause.message : "请求失败，请重试。"); setInput(text); }
    } finally {
      if (active.current === controller) active.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const apply = () => {
    if (!proposal || !confirmed || disabled || busy) return;
    if (basis !== comparisonFingerprint(getDecision())) { setError("比较内容已修改，请重新开始问答，以免覆盖你的修改。"); return; }
    try {
      if (onChange(proposalChange(proposal))) { reset(); onApplied(); }
      else setError("草稿未能应用，请检查页面保存提示。预览仍保留。");
    } catch { setError("草稿未能通过校验，当前决策未改变。"); }
  };

  return <section className="assistant-panel" hidden={!open} aria-label="问答设计助手">
    <header className="assistant-heading"><div><p className="eyebrow">先聊清楚，再开始比较</p><h2>一起梳理这次选择</h2><p>一次回答一个问题，逐步整理方案、在意的方面和权重。</p></div><button type="button" className="text-button" onClick={onClose}>收起助手</button></header>
    <div className="assistant-toolbar"><button type="button" className="secondary-button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>API 与提示词设置</button><button type="button" className="text-button" disabled={busy || disabled || messages.length === 0} onClick={reset}>重新开始问答</button></div>
    {settingsOpen && <fieldset className="assistant-settings" disabled={busy || disabled}>
      <legend>连接你的模型服务</legend>
      <div className="assistant-settings-grid"><label className="dj-field">API 地址<input aria-label="API 地址" type="url" value={settings.baseUrl} onChange={(e) => { setSettingsNotice(""); setSettings({ ...settings, baseUrl: e.target.value }); }} placeholder="https://服务地址/v1" /><small>填写基础地址（通常含 /v1），也可填完整 /chat/completions 地址。</small></label>
        <label className="dj-field">模型名称<input aria-label="模型名称" value={settings.model} onChange={(e) => { setSettingsNotice(""); setSettings({ ...settings, model: e.target.value }); }} placeholder="填写服务商提供的模型 ID" /></label>
        <label className="dj-field">API 密钥<input aria-label="API 密钥" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => { setApiKey(e.target.value); setSessionApiKey(e.target.value); }} placeholder="本机无需鉴权的服务可以留空" /><small>只保留在页面内存中，刷新后清除，不进入备份。</small></label>
        <label className="dj-field">提示词预设<select aria-label="提示词预设" value={settings.presetId} onChange={(e) => { const preset = promptPresets.find((item) => item.id === e.target.value)!; setSettingsNotice(""); setSettings({ ...settings, presetId: preset.id, systemPrompt: preset.prompt }); }}>{promptPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label></div>
      <details><summary>查看或编辑系统提示词</summary><label className="dj-field">系统提示词<textarea aria-label="系统提示词" rows={9} maxLength={12000} value={settings.systemPrompt} onChange={(e) => { setSettingsNotice(""); setSettings({ ...settings, systemPrompt: e.target.value }); }} /></label><button className="text-button" type="button" onClick={() => setSettings({ ...settings, systemPrompt: (promptPresets.find((item) => item.id === settings.presetId) ?? promptPresets[0]).prompt })}>恢复所选预设</button></details>
      <button type="button" className="secondary-button" onClick={saveSettings}>保存连接与提示词</button>
    </fieldset>}
    {settingsNotice && <p className="assistant-disclosure" role="status">{settingsNotice}</p>}
    <p className="assistant-disclosure">发送后，当前问题、方案、维度、底线及本轮问答会交给你配置的模型服务：<strong>{settings.baseUrl || "尚未设置"}</strong>。聊天仅在当前编辑页面保留；应用后的草稿保存在本机。</p>
    <div className="assistant-chat" role="log" aria-label="问答记录" aria-live="polite">
      <div className="assistant-message assistant"><strong>决策助手</strong><p>先从困扰你的地方说起：你正在做什么选择？最让你犹豫的是什么？</p></div>
      {messages.map((message, index) => <div className={`assistant-message ${message.role}`} key={index}><strong>{message.role === "user" ? "你" : "决策助手"}</strong><p>{message.display ?? message.content}</p></div>)}
      {busy && <p role="status">正在整理你的回答…</p>}<div ref={chatEnd} />
    </div>
    {stale && <p role="alert" className="workspace-alert">比较内容已修改。请重新开始问答，让助手使用最新结构。</p>}
    {error && <p role="alert" className="workspace-alert">{error}</p>}
    <form className="assistant-compose" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
      <label className="dj-field">你的回答<textarea aria-label="你的回答" value={input} maxLength={6000} disabled={busy || disabled} onChange={(e) => setInput(e.target.value)} placeholder="例如：我在犹豫留在现在的工作，还是接受新公司的机会…" /></label>
      <div className="simple-actions"><button className="primary-button" disabled={busy || disabled || stale || !input.trim()} type="submit">发送回答</button>
        <button type="button" className="secondary-button" disabled={busy || disabled || stale || messages.length === 0} onClick={() => void send(`${input.trim() ? `${input.trim()}\n` : ""}请根据目前回答形成第一轮设计草稿，把未确认的假设写进备注，评分留空。`)}>整理首轮草稿</button>
        {busy && <button type="button" className="text-button" onClick={() => active.current?.abort()}>停止请求</button>}</div>
    </form>
    {proposal && <section className="assistant-proposal" aria-label="首轮设计预览"><h3>首轮设计预览</h3><h4>{proposal.title}</h4><p>{proposal.objective}</p>
      <h4>候选方案</h4><ul>{proposal.options.map((item) => <li key={item.name}><strong>{item.name}{item.isStatusQuo ? "（现状 / 延后）" : ""}</strong> — {item.description || "暂无备注"}</li>)}</ul>
      <h4>你在意的方面</h4><ul>{proposal.criteria.map((item) => <li key={item.name}><strong>{item.name} · {Number((item.weight / proposal.criteria.reduce((sum, c) => sum + c.weight, 0) * 100).toFixed(1))}%</strong><p>{item.description || "应用后可补充备注"}</p></li>)}</ul>
      {proposal.constraints.length > 0 && <><h4>还需核实的底线</h4><ul>{proposal.constraints.map((item) => <li key={item.label}>{item.label} — {item.description}</li>)}</ul></>}
      <p>应用后可继续修改权重、填写评分，也可以先回复助手调整这份草稿。</p>
      <label className="assistant-confirm"><input type="checkbox" checked={confirmed} disabled={busy || disabled || stale} onChange={(e) => setConfirmed(e.target.checked)} /><span>用这份草稿替换当前目标、方案、维度和底线，清空当前评分。历史快照与执行记录保留。</span></label>
      <button className="primary-button" type="button" disabled={!confirmed || busy || disabled || stale} onClick={apply}>应用草稿，检查权重 →</button>
    </section>}
  </section>;
}
