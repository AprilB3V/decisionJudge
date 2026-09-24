import { z } from "zod";
import { promptPresets } from "../domain/assistant";

export type AssistantSettings = { baseUrl: string; model: string; presetId: string; systemPrompt: string };
const settingsSchema = z.object({ baseUrl: z.string().max(2000), model: z.string().max(200), presetId: z.string().max(100), systemPrompt: z.string().max(12000) });
const storageKey = "decisionjudge-assistant-settings-v1";
let memoryKey = "";
export const getSessionApiKey = () => memoryKey;
export const setSessionApiKey = (value: string) => { memoryKey = value; };
export const defaultAssistantSettings = (): AssistantSettings => ({ baseUrl: "https://api.openai.com/v1", model: "", presetId: "general", systemPrompt: promptPresets[0].prompt });

export function loadAssistantSettings(): AssistantSettings {
  try { return settingsSchema.parse(JSON.parse(localStorage.getItem(storageKey) ?? "null")); }
  catch { return defaultAssistantSettings(); }
}
export function saveAssistantSettings(settings: AssistantSettings) {
  // Schema strips unknown fields, including an accidentally passed API key.
  localStorage.setItem(storageKey, JSON.stringify(settingsSchema.parse(settings)));
}
