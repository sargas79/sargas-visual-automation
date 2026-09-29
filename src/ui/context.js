import { MODULE_ID } from "../constants.js";
import { log } from "../logger.js";

/**
 * Shared state and thin Foundry wrappers for the UI area. Everything that
 * touches a Foundry global is guarded so the module can be imported (and the
 * pure view models tested) without Foundry.
 */

let currentApi = null;

/** Remember the module api object (set by src/ui/index.js#init, or by tests). */
export function setApi(api) {
  currentApi = api;
}

/** @returns {object|null} the module api object. */
export function getApi() {
  return currentApi ?? globalThis.game?.modules?.get?.(MODULE_ID)?.api ?? null;
}

/** Path of a template shipped with the module. */
export function templatePath(name) {
  return `modules/${MODULE_ID}/templates/${name}`;
}

/** Localize a key (with optional format data); returns the key when i18n is unavailable. */
export function t(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

/** Show a notification (falls back to the console outside Foundry). */
export function notify(level, key, data) {
  const message = t(key, data);
  const notifications = globalThis.ui?.notifications;
  if (notifications?.[level]) notifications[level](message);
  else log[level === "error" ? "error" : level === "warn" ? "warn" : "info"](message);
}

/** ApplicationV2 + HandlebarsApplicationMixin base class, or null outside Foundry. */
export function getHandlebarsAppBase() {
  const api = globalThis.foundry?.applications?.api;
  if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin) return null;
  return api.HandlebarsApplicationMixin(api.ApplicationV2);
}

/** Currently controlled tokens on the canvas. */
export function controlledTokens() {
  return [...(globalThis.canvas?.tokens?.controlled ?? [])];
}

/** Tokens targeted by the current user. */
export function targetedTokens() {
  return [...(globalThis.game?.user?.targets ?? [])];
}

/** Copy text to the clipboard. */
export async function copyText(text) {
  try {
    if (globalThis.game?.clipboard?.copyPlainText) await game.clipboard.copyPlainText(text);
    else await globalThis.navigator.clipboard.writeText(text);
    notify("info", "SVA.UI.Browser.Copied", { path: text });
  } catch (err) {
    log.warn("Clipboard copy failed", err);
  }
}

/** Download a string as a file. */
export function saveTextFile(text, filename, type = "application/json") {
  const save = globalThis.foundry?.utils?.saveDataToFile;
  if (save) return save(text, type, filename);
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ask a yes/no question with DialogV2. Resolves to a boolean. */
export async function confirm(titleKey, contentKey, data) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!DialogV2) return globalThis.confirm?.(t(contentKey, data)) ?? false;
  const safe = data && Object.fromEntries(Object.entries(data).map(([k, v]) => [k, escapeHtml(v)]));
  const result = await DialogV2.confirm({
    window: { title: t(titleKey, data) },
    content: `<p>${t(contentKey, safe)}</p>`,
    rejectClose: false
  });
  return result === true;
}

/** Read the JSON payload of a drag event. */
export function dragEventData(event) {
  const TextEditor = globalThis.foundry?.applications?.ux?.TextEditor;
  try {
    if (TextEditor) return (TextEditor.implementation ?? TextEditor).getDragEventData(event);
    return JSON.parse(event.dataTransfer?.getData("text/plain") || "{}");
  } catch {
    return {};
  }
}

/** Resolve a document uuid. */
export async function resolveUuid(uuid) {
  const fn = globalThis.fromUuid ?? globalThis.foundry?.utils?.fromUuid;
  return uuid && fn ? fn(uuid) : null;
}

/** Escape a string for HTML output. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
