/**
 * Built-in system adapters. The automation core (src/automation) registers
 * every class listed here and activates the one whose static isActive() is true.
 * To add a system: create src/systems/<system-id>/ extending
 * src/shared/adapter.js#SystemAdapter and add it to this list.
 */
export const BUILTIN_ADAPTERS = [];
