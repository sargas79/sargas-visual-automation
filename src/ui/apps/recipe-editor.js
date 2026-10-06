/**
 * Helpers shared by windows that embed templates/partials/recipe-form.hbs
 * (item recipe editor, rules manager).
 */
import { readFormElements } from "../models/form-utils.js";
import { formToRecipe, jsonFieldError, recipeToFormModel } from "../models/recipe-form.js";
import { getApi, renderModuleTemplate, t } from "../context.js";
import { openBrowser } from "./browser.js";

export const RECIPE_FORM_TEMPLATE = "partials/recipe-form.hbs";

/** Presets published by the automation core ({} when unavailable). */
export function getPresets() {
  const presets = getApi()?.automation?.presets;
  return presets && typeof presets === "object" ? presets : {};
}

/** Render the recipe sub-form for a recipe. */
export async function renderRecipeForm(recipe, idPrefix) {
  const model = recipeToFormModel(recipe, { presets: getPresets() });
  return renderModuleTemplate(RECIPE_FORM_TEMPLATE, { ...model, idPrefix });
}

/** Read the recipe currently in a form element. */
export function readRecipe(form, base) {
  return formToRecipe(readFormElements(form?.elements ?? []), { presets: getPresets(), base });
}

/** @returns {object|null} the configured FilePicker class. */
export function getFilePickerClass() {
  // VERIFY(v14): foundry.applications.apps.FilePicker; `.implementation` is the configured subclass.
  const FP = globalThis.foundry?.applications?.apps?.FilePicker;
  return FP?.implementation ?? FP ?? null;
}

/**
 * Open the Foundry file browser and write the chosen file into the named input.
 * @param {HTMLElement} root  element containing the input
 * @param {string} name       input name
 * @param {{type?: string}} [options]  FilePicker type ("audio", "image", ...)
 * @returns {object|null} the FilePicker, or null when unavailable
 */
export function pickFileInto(root, name, { type = "audio" } = {}) {
  const input = root?.querySelector(`[name="${CSS.escape(name)}"]`);
  const FilePicker = getFilePickerClass();
  if (!input || !FilePicker) return null;
  // VERIFY(v14): FilePicker options {type, current, callback}; render({force: true}).
  const picker = new FilePicker({
    type,
    current: input.value || "",
    callback: (path) => {
      input.value = path;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  picker.render({ force: true });
  return picker;
}

/**
 * Open the browser as a picker and write the chosen path into the named input.
 * @param {HTMLElement} root  element containing the input
 * @param {string} name       input name
 */
export function pickAnimationInto(root, name) {
  const input = root?.querySelector(`[name="${CSS.escape(name)}"]`);
  if (!input) return null;
  return openBrowser({
    path: input.value || undefined,
    onPick: (path) => {
      input.value = path;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

const JSON_FIELD = "textarea.sva-json";
const JSON_ERROR = "sva-json-error";
const jsonBound = new WeakSet();

/**
 * Mark a JSON textarea valid or invalid (`.sva-invalid`, `aria-invalid`, and an
 * error hint right after it, linked with `aria-describedby`).
 * @param {HTMLTextAreaElement} field
 * @returns {boolean} true when the content is valid
 */
export function validateJsonField(field) {
  if (!field) return true;
  const error = jsonFieldError(field.value, { object: field.dataset?.svaJson === "object" });
  field.classList.toggle("sva-invalid", !!error);
  let hint = field.nextElementSibling?.classList?.contains(JSON_ERROR) ? field.nextElementSibling : null;
  if (!error) {
    field.removeAttribute("aria-invalid");
    if (hint) {
      hint.hidden = true;
      hint.textContent = "";
      field.removeAttribute("aria-describedby");
    }
    return true;
  }
  field.setAttribute("aria-invalid", "true");
  if (!hint && typeof document !== "undefined") {
    hint = document.createElement("p");
    hint.className = `hint ${JSON_ERROR}`;
    hint.id = `${field.id || field.name.replace(/[^\w-]/g, "-")}-error`;
    field.after(hint);
  }
  if (hint) {
    hint.hidden = false;
    hint.textContent = t("SVA.UI.Recipe.JsonInvalid", { error });
    field.setAttribute("aria-describedby", hint.id);
  }
  return false;
}

/** Validate every JSON textarea under `root`. @returns {boolean} true when all are valid */
export function validateJsonFields(root) {
  let valid = true;
  for (const field of root?.querySelectorAll?.(JSON_FIELD) ?? []) valid = validateJsonField(field) && valid;
  return valid;
}

/**
 * Validate JSON textareas while the user types (one delegated listener per root).
 * @param {HTMLElement} root  a persistent element containing the recipe form
 */
export function bindJsonValidation(root) {
  if (!root?.addEventListener || jsonBound.has(root)) return;
  jsonBound.add(root);
  root.addEventListener("input", (event) => {
    if (event.target?.matches?.(JSON_FIELD)) validateJsonField(event.target);
  });
}
