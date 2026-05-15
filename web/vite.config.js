import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin in dev: the browser can read WWW-Authenticate and send
      // the Authorization credential without CORS friction.
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
