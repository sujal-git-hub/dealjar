import { randomBytes } from "node:crypto";

/** Short URL-safe id (base36-ish, 12 chars). */
export const newId = () =>
  randomBytes(9)
    .toString("base64")
    .replace(/[+/=]/g, "")
    .slice(0, 12)
    .toLowerCase()
    .padEnd(12, "0");
