import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Next's TypeScript override omits ESM declaration files; retain its parser/rules.
  ...nextVitals.map((config) => config.name === "next/typescript"
    ? { ...config, files: [...config.files, "**/*.d.mts"] }
    : config),
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "import/no-anonymous-default-export": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "spikes/media-worker/node_modules/**",
  ]),
]);
