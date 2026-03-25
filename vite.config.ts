import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*.ts": ["vp check --fix", "npx eslint --fix"],
    "*.md": "vp check --fix",
  },
});
