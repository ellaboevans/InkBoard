import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // E2E build dir, test output
    ".next-e2e/**",
    // Production build for the offline E2E (playwright.offline.config.ts)
    ".next-offline/**",
    ".next-build/**",
    ".next-preview/**",
    "test-results/**",
    "playwright-report/**",
    // Video walkthrough recordings, renders and builds (video/README.md)
    "video/.out/**",
  ]),
]);

export default eslintConfig;
