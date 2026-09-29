import { MODULE_TITLE } from "./constants.js";

const PREFIX = `${MODULE_TITLE} |`;

export const log = {
  debug: (...args) => {
    if (log.debugEnabled) console.debug(PREFIX, ...args);
  },
  info: (...args) => console.info(PREFIX, ...args),
  warn: (...args) => console.warn(PREFIX, ...args),
  error: (...args) => console.error(PREFIX, ...args),
  debugEnabled: false
};
