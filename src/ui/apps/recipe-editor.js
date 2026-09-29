/**
 * Helpers shared by windows that embed templates/partials/recipe-form.hbs
 * (item recipe editor, rules manager).
 */
import { readFormElements } from "../models/form-utils.js";
import { formToRecipe, recipeToFormModel } from "../models/recipe-form.js";
import { getApi, renderModuleTemplate } from "../context.js";
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
