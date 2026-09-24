import { afterEach, describe, expect, it, vi } from "vitest";
import { chatEndpoint, requestAssistant } from "./assistantClient";
import { defaultAssistantSettings, loadAssistantSettings, saveAssistantSettings, setSessionApiKey, getSessionApiKey } from "./assistantSettings";
import { createDecision } from "../application/decisionService";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); setSessionApiKey(""); });
const settings = () => ({ ...defaultAssistantSettings(), baseUrl: "https://example.test/v1/", model: "test-model" });
const decision = () => createDecision("job-change");

describe("compatible Chat Completions adapter", () => {
  it("normalizes base or full endpoints and limits cleartext to loopback", () => {
    expect(chatEndpoint("https://example.test/v1/")).toBe("https://example.test/v1/chat/completions");
    expect(chatEndpoint("http://localhost:1234/v1/chat/completions/")).toBe("http://localhost:1234/v1/chat/completions");
    for (const invalid of ["http://example.test/v1", "https://user:secret@example.test/v1", "https://example.test/?key=secret", "ftp://example.test", "https://example.test/#key"]) expect(() => chatEndpoint(invalid)).toThrow();
  });
  it("uses explicit model/key with no cookies or redirects, sends only projected context", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"message":"最担心什么？","proposal":null}' } }] })));
    vi.stubGlobal("fetch", fetcher);
    const current = decision(); current.scores[0].evidence = "不发送的证据";
    const reply = await requestAssistant(settings(), " session-secret ", current, [{ role: "user", content: "我想换工作" }]);
    expect(reply.message).toBe("最担心什么？");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect(init).toMatchObject({ credentials: "omit", redirect: "error", headers: { Authorization: "Bearer session-secret" } });
    const body = JSON.parse(init.body);
    expect(body.model).toBe("test-model"); expect(body.stream).toBe(false);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "我想换工作" });
    expect(init.body).not.toContain("session-secret"); expect(init.body).not.toContain("不发送的证据");
  });
  it("does not reveal provider error bodies or keys", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("session-secret", { status: 401 })));
    await expect(requestAssistant(settings(), "session-secret", decision(), [])).rejects.toThrow("401");
    await expect(requestAssistant(settings(), "session-secret", decision(), [])).rejects.not.toThrow("session-secret");
  });
  it.each([
    { choices: [{ message: { content: "" } }] },
    { choices: [] },
    { choices: [{ finish_reason: "length", message: { content: "partial" } }] },
    { choices: [{ message: { content: '{"message":"草稿","proposal":{}}' } }] },
  ])("rejects unusable successful responses %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(requestAssistant(settings(), "", decision(), [])).rejects.toThrow();
  });
  it("aborts after the timeout and supports manual cancellation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))));
    const pending = requestAssistant(settings(), "", decision(), []);
    const assertion = expect(pending).rejects.toThrow("60 秒");
    await vi.advanceTimersByTimeAsync(60000); await assertion;
    const controller = new AbortController();
    const cancelled = requestAssistant(settings(), "", decision(), [], controller.signal);
    const cancellation = expect(cancelled).rejects.toThrow("已停止");
    controller.abort(); await cancellation;
  });
  it("stores non-secret config and prompt customizations only", () => {
    const configured = { ...settings(), systemPrompt: "每轮只问一个问题", apiKey: "never-save" };
    saveAssistantSettings(configured); setSessionApiKey("memory-only");
    expect(loadAssistantSettings().systemPrompt).toBe(configured.systemPrompt);
    expect(getSessionApiKey()).toBe("memory-only");
    expect(JSON.stringify(localStorage)).not.toMatch(/never-save|memory-only|apiKey/);
  });
});
