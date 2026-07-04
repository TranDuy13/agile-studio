import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web",
  plugins: [react()],
  server: { port: 5311, proxy: {
    "/api": "http://localhost:4311",
    "/ws": { target: "ws://localhost:4311", ws: true },
  } },
});
