import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const WORKER_DEV_SERVER = "http://127.0.0.1:8787";
const WORKER_PATHS = [
  "/me",
  "/login",
  "/logout",
  "/callback",
  "/keys",
  "/token",
  "/.well-known",
  "/api",
];

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../web-dist", emptyOutDir: true },
  server: {
    proxy: Object.fromEntries(
      WORKER_PATHS.map((path) => [path, WORKER_DEV_SERVER]),
    ),
  },
});
