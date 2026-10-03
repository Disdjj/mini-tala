import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// 构建时把 JS/CSS 全部内联进 dist/index.html，方便作为单文件分享（例如 GitHub Gist）
export default defineConfig({
  plugins: [viteSingleFile()],
});
