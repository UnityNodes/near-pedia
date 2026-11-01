import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

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
    // Custom ignores
    ".claude/**",
    "node_modules/**",
    "data/**",
    // Build output the deploy procedure leaves behind. A deploy builds into
    // `.next.new` and keeps the previous build for rollback, and the rollback
    // dir carries a DATED name (`.next.prev-0829b`), so any literal list here
    // goes stale on the next deploy: the 16.3.3 upgrade lint drowned in 25k
    // warnings from exactly that. One glob covers the live build and every
    // sibling the procedure will ever leave.
    ".next*/**",
    // Local agent tooling, all of it already in .gitignore.
    ".agents/**",
    ".codex/**",
    ".impeccable/**",
    ".dbg.ts",
    "*.bak-impeccable",
  ]),
  // Rule-severity overrides. These stay warnings, not CI-blocking errors,
  // because the code they flag is legitimate and rewriting it to satisfy the
  // rule would be worse than the warning:
  //  - prefer-const fires on `let x: T;` type-carrier declarations in
  //    mcp-server.ts (the value is assigned once in a branch, or only its
  //    `typeof` is read) and on a partial destructure whose sibling binding
  //    IS reassigned. None are safely auto-fixable.
  //  - set-state-in-effect flags a debounced reset and a stagger-reveal, both
  //    intentional; the React Compiler rule is an advisory perf heuristic here.
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "prefer-const": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
