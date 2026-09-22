// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Comfy Board lint config.
 *
 * This exists for ONE rule above all others.
 *
 * A Supabase/PostgREST query builder is a lazy thenable: the HTTP request is
 * only issued when `.then()` is called. So
 *
 *     supabase.from("project_tasks").update({ progress: 100 }).eq("id", id);
 *
 * compiles, type-checks, runs, and does absolutely nothing. No request, no
 * error, no warning. Roughly twenty of these had shipped and gone unnoticed
 * for months — including the one that meant every timer session failed to
 * write to `time_logs`.
 *
 * `no-floating-promises` with `checkThenables: true` makes that pattern a
 * lint error at author time. It is the single highest-value rule in this file
 * and the reason the config is type-aware (which is slower, but that check is
 * impossible without type information).
 *
 * Everything else is deliberately set to "warn" or off. A config that lights
 * up with 400 problems on day one gets ignored; this one should be quiet
 * except where it's telling you about a real bug.
 */
export default tseslint.config(
  {
    // Not our code, or generated.
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "next-env.d.ts",
      "*.config.js",
      "*.config.mjs",
      "comfy-board/**", // stray nested copy in the repo root
    ],
  },

  js.configs.recommended,

  // Type-aware rules. `projectService` picks up tsconfig.json automatically.
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      /* ── The reason this config exists ─────────────────────────────── */

      // A floating thenable is a query that never runs. Error, not warn.
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          // Supabase builders are thenables, not Promises. Without this the
          // rule sees nothing wrong with them.
          checkThenables: true,
          // `void supabase.from(...)` is NOT an acceptable escape hatch here —
          // it silences the rule without sending the request. Use await, or
          // fireAndForget() from lib/db-helpers.ts.
          ignoreVoid: false,
          ignoreIIFE: true,
        },
      ],

      // Catches `if (somePromise)` — always truthy, always a bug.
      //
      // checksVoidReturn is off deliberately: it fires on async event
      // listeners, `setTimeout(asyncFn)` and async handlers passed to
      // `() => void` props, all of which are normal React and none of which
      // are the failure mode this config exists to catch. Leaving it on
      // produced 21 findings and zero bugs.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: false, checksConditionals: true },
      ],

      // Awaiting a non-thenable is usually a sign the call was built wrong.
      "@typescript-eslint/await-thenable": "error",

      /* ── React correctness ─────────────────────────────────────────── */

      "react-hooks/rules-of-hooks": "error",
      // Warn, not error: several effects here deliberately narrow their deps
      // and say so in a comment. Worth seeing, not worth blocking on.
      "react-hooks/exhaustive-deps": "warn",

      /* ── Turned down so the useful signal isn't buried ─────────────── */

      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Supabase returns `any` from untyped tables; until the DB types are
      // generated these would fire constantly and say nothing useful.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // Cosmetic on a codebase that casts Supabase's `any` results constantly.
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      // An async function with no await is fine when it satisfies an
      // interface that other implementations do await.
      "@typescript-eslint/require-await": "off",
    },
  },

  // Config and script files don't need the type-aware machinery.
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  }
);
