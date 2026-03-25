import effectEslint from "@effect/eslint-plugin";
import functional from "eslint-plugin-functional";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    files: ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts"],
    extends: [tseslint.configs.strict],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    files: ["packages/*/src/**/*.ts"],
    ...effectEslint.configs.recommended,
  },
  {
    files: ["packages/*/src/**/*.ts"],
    plugins: functional.configs.lite.plugins,
    rules: {
      // Functional rules — warn first, enforce later
      "functional/no-let": "warn",
      "functional/no-loop-statements": "warn",
      "functional/immutable-data": "warn",
      "functional/no-throw-statements": "warn",
      // Too noisy for now
      "functional/functional-parameters": "off",
      "functional/no-expression-statements": "off",
      "functional/no-return-void": "off",
      "functional/prefer-readonly-type": "off",
    },
  },
  {
    files: ["packages/*/test/**/*.ts"],
    rules: {
      // Relax in tests
      "functional/no-let": "off",
      "functional/no-loop-statements": "off",
      "functional/immutable-data": "off",
      "functional/no-throw-statements": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
