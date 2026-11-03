import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

// Dependency direction from docs/DESIGN.md §3
const allow = {
  parser: ["defs", "model"], defs: ["model"], model: [], gamedata: ["model"],
  analysis: ["model", "gamedata"], coach: ["model", "analysis", "gamedata"],
  commander: ["model", "analysis", "coach", "gamedata"], "ui-kit": [],
  web: ["parser", "defs", "model", "gamedata", "analysis", "coach", "commander", "ui-kit"], api: ["model"],
};
const pkgs = ["parser","defs","model","gamedata","analysis","coach","commander","ui-kit"];
export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "fixtures/**", "tools/**"] },
  js.configs.recommended, ...tseslint.configs.recommended,
  {
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        ...pkgs.map((p) => ({ type: p, pattern: `packages/${p}/**`, mode: "full" })),
        { type: "web", pattern: "apps/web/**", mode: "full" },
        { type: "api", pattern: "services/api/**", mode: "full" },
      ],
      "import/resolver": { typescript: true },
    },
    rules: {
      "boundaries/element-types": ["error", {
        default: "disallow",
        rules: Object.entries(allow).map(([from, to]) => ({ from, allow: [...to, from] })),
      }],
    },
  },,
  // Raw replay JSON/pickles are untyped by nature; the parser's OUTPUT is typed and validated by @wotrep/model's zod schema.
  { files: ["packages/parser/src/**"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
);
