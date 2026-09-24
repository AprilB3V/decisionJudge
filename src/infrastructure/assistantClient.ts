import { assistantContext, parseAssistantReply, replyContract, type ChatMessage } from "../domain/assistant";
import type { Decision } from "../domain/types";
import type { AssistantSettings } from "./assistantSettings";

export function chatEndpoint(baseUrl: string): string {
  let url: URL;
  try { url = new URL(baseUrl.trim()); } catch { throw new Error("请填写完整的 API 地址，例如 https://服务地址/v1。"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash) throw new Error("API 地址需要 HTTPS（本机可用 HTTP），且不能包含账号、密码、查询参数或片段。");
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/chat/completions")) url.pathname += "/chat/completions";
  return url.toString();
}

export async function requestAssistant(settings: AssistantSettings, apiKey: string, decision: Decision, messages: ChatMessage[], signal?: AbortSignal) {
  const endpoint = chatEndpoint(settings.baseUrl);
  if (!settings.model.trim()) throw new Error("请填写服务商提供的模型名称。");
  if (!settings.systemPrompt.trim()) throw new Error("请选择预设或填写系统提示词。");
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 60000);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
    const response = await fetch(endpoint, {
      method: "POST", headers, signal: controller.signal, redirect: "error", credentials: "omit",
      body: JSON.stringify({ model: settings.model.trim(), stream: false, messages: [
        { role: "system", content: `${settings.systemPrompt}\n\n${replyContract}` },
        { role: "user", content: `当前比较结构（供参考，可在问答中修订）：\n${JSON.stringify(assistantContext(decision))}` },
        ...messages,
      ] }),
    });
    if (!response.ok) {
      const reason = response.status === 401 || response.status === 403 ? "请检查密钥与访问权限。" : response.status === 429 ? "请求额度或频率受限，请稍后再试。" : response.status === 404 ? "请检查 API 地址和模型名。" : "服务暂时不可用，请稍后重试。";
      throw new Error(`API 请求失败（${response.status}）。${reason}`);
    }
    let result;
    try { result = await response.json(); } catch { throw new Error("API 返回的内容不是 JSON，请检查接口是否为 Chat Completions。"); }
    const choice = result?.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error("助手回复被服务商截断，请要求更简短的草稿后重试。");
    if (typeof choice?.message?.content !== "string") throw new Error("API 未返回文本回复，请检查兼容接口与模型配置。");
    const content = choice.message.content;
    return { ...parseAssistantReply(content), content };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(timedOut ? "请求超过 60 秒，请重试或更换模型。" : "已停止本次请求，输入仍保留。");
    if (error instanceof TypeError) throw new Error("无法连接 API，请检查网络及地址；服务需允许浏览器跨域访问（CORS），或使用支持跨域的兼容网关。");
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
