import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(resolve(root, "public/wasm"), { recursive: true });
const source = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
for (const file of readdirSync(source))
  copyFileSync(resolve(source, file), resolve(root, "public/wasm", file));
copyFileSync(
  resolve(root, "node_modules/@mediapipe/tasks-vision/vision_bundle.js"),
  resolve(root, "public/wasm/vision_bundle.js"),
);
