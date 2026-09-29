/**
 * Built-in system adapters. The automation core (src/automation) registers
 * every class listed here and activates the one whose static isActive() is true.
 * To add a system: create src/systems/<system-id>/ extending
 * src/shared/adapter.js#SystemAdapter and add it to this list.
 */
import Pf2eAdapter from "./pf2e/index.js";
import Dnd5eAdapter from "./dnd5e/index.js";

export const BUILTIN_ADAPTERS = [Pf2eAdapter, Dnd5eAdapter];
