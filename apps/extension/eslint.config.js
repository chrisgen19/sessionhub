import { reactConfig } from "@sessionhub/eslint-config/react";

export default [
  ...reactConfig,
  { ignores: [".wxt/**", ".output/**", "playwright-report/**", "test-results/**"] },
  {
    // Playwright fixtures call `use()`, which is not the React hook of the same name.
    files: ["e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];
