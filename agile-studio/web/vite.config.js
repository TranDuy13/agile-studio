import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { config } from "../server/config.js"; // dùng chung .env: cổng + proxy theo SERVER_PORT/WEB_PORT
export default defineConfig({
  root: "web",
  plugins: [react()],
  server: { port: config.webPort, proxy: {
    "/api": `http://localhost:${config.serverPort}`,
    "/ws": { target: `ws://localhost:${config.serverPort}`, ws: true },
  } },
});
