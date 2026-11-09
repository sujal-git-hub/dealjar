/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** "mock" (default): demo data in the browser. "live": the backend at /api. */
  readonly VITE_DATA?: "mock" | "live";
}
