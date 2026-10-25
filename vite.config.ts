import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri erwartet einen festen Port und soll Rust-Fehler nicht verdecken.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
