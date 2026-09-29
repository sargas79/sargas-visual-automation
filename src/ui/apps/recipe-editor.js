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
