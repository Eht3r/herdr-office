import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = `http://127.0.0.1:${process.env.OFFICE_PORT ?? "3000"}`;

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: "three-renderer",
              priority: 20,
              test: /[/]three[/]build[/]three\.module\.js$/,
            },
            {
              name: "three-core",
              priority: 30,
              test: /[/]three[/]build[/]three\.core\.js$/,
            },
          ],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    proxy: { "/api": backend, "/ws": { target: backend, ws: true } },
  },
});
