import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri erwartet einen festen Port und soll Rust-Fehler nicht verdecken.
// Relative Pfade, damit die Web-App auch unter einer Unteradresse (GitHub Pages) läuft.
export default defineConfig({
  base: "./",
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
