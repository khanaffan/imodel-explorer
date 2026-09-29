import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**", "public/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "test/**/*.ts", "scripts/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "warn",
    },
  },
);
