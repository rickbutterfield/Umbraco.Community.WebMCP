import { defineConfig } from "vite";

export default defineConfig({
    build: {
        lib: {
            // One entry point per surface, so the server can serve only the enabled ones. They share the tool hub
            // through a common chunk.
            entry: {
                "umbraco-webmcp": "src/index.ts",
                "umbraco-webmcp-model-context": "src/surfaces/model-context.entry.ts",
                "umbraco-webmcp-page-api": "src/surfaces/page-api.entry.ts",
            },
            formats: ["es"],
            fileName: (_format, entryName) => `${entryName}.js`,
        },
        outDir: "./wwwroot",
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
            external: [/^@umbraco-cms/],
        },
    },
});
