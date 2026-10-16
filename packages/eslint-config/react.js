import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { baseConfig } from "./base.js";

/** Shared flat config for React surfaces (extension pages, web client components). */
export const reactConfig = [
  ...baseConfig,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
];

export default reactConfig;
