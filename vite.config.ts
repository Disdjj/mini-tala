import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// gistpreview 这类预览器用 document.write 注入页面，内联的 <script type="module">
// 在这种方式下不会执行。所以产物用 IIFE 格式，并去掉 type="module"，做成普通脚本。
// 普通内联脚本会在解析到它时立即执行，因此要挪到 </body> 前，保证 DOM 已经就绪。
function classicInlineScript(): Plugin {
  return {
    name: "classic-inline-script",
    enforce: "post",
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".html")) continue;
        let html = String(file.source);
        const match = html.match(/<script type="module" crossorigin>([\s\S]*?)<\/script>/);
        if (!match) continue;
        html = html.replace(match[0], "");
        html = html.replace("</body>", `<script>${match[1]}</script>\n</body>`);
        file.source = html;
      }
    },
  };
}

// 构建时把 JS/CSS 全部内联进 dist/index.html，方便作为单文件分享（例如 GitHub Gist）
export default defineConfig({
  plugins: [viteSingleFile(), classicInlineScript()],
  build: {
    rollupOptions: {
      output: { format: "iife" },
    },
  },
});
