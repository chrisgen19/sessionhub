import { reactConfig } from "@sessionhub/eslint-config/react";

export default [
  ...reactConfig,
  { ignores: [".wxt/**", ".output/**", "playwright-report/**", "test-results/**"] },
  {
    // AGENTS.md: no Prisma or database access from the extension; server APIs only.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "pg", message: "The extension must never talk to PostgreSQL." }],
          patterns: [
            { group: ["@sessionhub/database", "@sessionhub/database/*"], message: "Server-only package; use the sync API." },
            { group: ["@prisma/*", "prisma", "prisma/*"], message: "Prisma is server-only." },
          ],
        },
      ],
    },
  },
  {
    // Playwright fixtures call `use()`, which is not the React hook of the same name.
    files: ["e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];
