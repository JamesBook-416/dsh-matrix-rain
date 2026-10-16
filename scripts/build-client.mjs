/*
 * scripts/build-client.mjs — inline src/engine.js into src/client.template.js
 * at the @INJECT_ENGINE@ marker and emit lib/client.js.
 *
 * Deliberately dependency-free: the whole plugin ships without a build
 * toolchain; this script exists so the browser-tested engine source is
 * byte-identical to the one shipped inside the client bundle.
 *
 * Usage: node scripts/build-client.mjs   (run from the package root)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const enginePath = join(root, "src", "engine.js");
const templatePath = join(root, "src", "client.template.js");
const outPath = join(root, "lib", "client.js");

const engine = readFileSync(enginePath, "utf8");
const template = readFileSync(templatePath, "utf8");

const marker = "// @INJECT_ENGINE@";
if (!template.includes(marker)) {
  throw new Error(`build-client: marker ${marker} missing from template`);
}
if (engine.includes(marker)) {
  throw new Error("build-client: engine source unexpectedly contains the marker");
}

// replacer function => no "$" pattern substitution surprises from engine source
const bundle = template.replace(marker, () => engine.trimEnd());

writeFileSync(outPath, bundle, "utf8");
console.log(`build-client: wrote ${outPath} (${bundle.length} bytes)`);
