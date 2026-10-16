/*
 * scripts/validate.mjs — pre-install safety battery for this skin package.
 *
 * Gate 1  JSON parse: package.json / skin.json / locale/*.json
 * Gate 2  YAML parse: cordis.patch.yml (uses the same yaml lib the profile ships)
 * Gate 3  Exports semantics: replicates @deepseek-ai/dsh-client-modules
 *         clientExportOf() — the exact check that bricked DSH on 2026-10-12
 *         when a plugin declared dsh.client without exports["./client"].
 * Gate 4  Self-reference resolution: createRequire(pkg).resolve("<name>/client")
 *         must reach lib/client.js (the incident doc's own verification method).
 * Gate 5  Syntax: node --check on lib/index.js + lib/client.js.
 * Extra   skin.json four essentials (id / package / bodyAttr / wiring.id) and
 *         package field === actual package name; declared files exist.
 *
 * Usage: node scripts/validate.mjs
 * Exit code 0 = all gates green (safe to install); 1 = any red.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(dirname(fileURLToPath(import.meta.url))));
let failures = 0;
const pass = (m) => console.log("PASS " + m);
const fail = (m) => { console.error("FAIL " + m); failures += 1; };

function read(p) { return readFileSync(join(root, p), "utf8"); }

/* ── Gate 1: JSON ── */
let pkg;
try {
  pkg = JSON.parse(read("package.json"));
  pass("package.json parses");
} catch (e) { fail("package.json parse: " + e.message); }
/* v0.5.0 standalone:skin.json 已移除;若意外存在则报错(会被皮肤管理器发现,破坏独立模式) */
if (existsSync(join(root, "skin.json"))) fail("skin.json still present — standalone mode requires its removal");
else pass("skin.json absent (standalone mode)");
for (const loc of ["locale/zh.json", "locale/en.json"]) {
  try { JSON.parse(read(loc)); pass(loc + " parses"); }
  catch (e) { fail(loc + " parse: " + e.message); }
}

/* ── Gate 3: exports semantics (clientExportOf replica) ── */
function clientExportOf(exportsField) {
  if (!exportsField || typeof exportsField !== "object") return undefined;
  const client = exportsField["./client"];
  if (typeof client === "string") return client;
  if (typeof client === "object" && client !== null) {
    const fallback = client.default;
    if (typeof fallback === "string") return fallback;
  }
  return undefined;
}
if (pkg) {
  const declaresClient = pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === "web";
  const rel = clientExportOf(pkg.exports);
  if (declaresClient && rel === undefined) {
    fail("FATAL declares dsh.client but exports no \"./client\" bundle (2026-10-12 brick mode)");
  } else if (rel !== undefined) {
    pass(`exports["./client"] = ${rel}`);
    if (!existsSync(join(root, rel))) fail(`exports target missing on disk: ${rel}`);
    else pass(`exports target exists: ${rel}`);
  } else {
    fail("dsh.client not declared — skin would never reach the GUI");
  }
  if (pkg.main && !existsSync(join(root, pkg.main))) fail("main missing: " + pkg.main);
  else pass("main exists: " + pkg.main);
}

/* ── Gate 4: self-reference resolution (incident-doc method) ── */
if (pkg) {
  try {
    const req = createRequire(join(root, "package.json"));
    const clientPath = req.resolve(pkg.name + "/client");
    if (!clientPath.endsWith(join("lib", "client.js"))) fail("unexpected client resolution: " + clientPath);
    else pass("createRequire resolves <pkg>/client -> " + clientPath);
    const mainPath = req.resolve(pkg.name);
    if (!mainPath.endsWith(join("lib", "index.js"))) fail("unexpected main resolution: " + mainPath);
    else pass("createRequire resolves <pkg> -> " + mainPath);
  } catch (e) {
    fail("self-reference resolution: " + e.message);
  }
}

/* ── Gate 5: syntax ── */
for (const f of ["lib/index.js", "lib/client.js"]) {
  try {
    execFileSync(process.execPath, ["--check", join(root, f)], { stdio: "pipe" });
    pass("node --check " + f);
  } catch (e) {
    fail("node --check " + f + ": " + String(e.stderr));
  }
}

/* ── Gate 2: YAML (profile's own yaml lib) ── */
const profilePkg = join(homedir(), ".dsh", "profiles", "desktop", "package.json"); // junction 与默认安装两种布局均命中
try {
  const profileRequire = createRequire(profilePkg);
  const YAML = profileRequire("yaml");
  const doc = YAML.parse(read("cordis.patch.yml"));
  const ok = Array.isArray(doc) && Array.isArray(doc[0]?.insert)
    && doc[0].insert[0]?.id === "matrix-rain"
    && typeof doc[0].insert[0]?.name === "string"
    && doc[0].insert[0].name === pkg?.name;
  if (ok) pass("cordis.patch.yml parses with profile yaml; insert id/name correct (standalone id)");
  else fail("cordis.patch.yml shape unexpected: " + JSON.stringify(doc));
} catch (e) {
  fail("cordis.patch.yml (profile yaml): " + e.message);
}

/* ── Extra: standalone 契约(旧皮肤身份必须清干净,否则皮肤管理器会发现并互斥) ── */
if (pkg) {
  const exportsList = Object.keys(pkg.exports || {});
  const straySkinRefs = exportsList.filter((k) => k.includes("skin.json"));
  const filesStr = JSON.stringify(pkg.files || []);
  if (straySkinRefs.length === 0 && !filesStr.includes("skin.json")) {
    pass("standalone contract: no skin.json in exports/files");
  } else {
    fail("standalone contract broken: skin.json still referenced in package.json");
  }
  if (pkg.dsh?.client?.inject && pkg.dsh.client.inject.length > 0) {
    fail("dsh.client.inject non-empty — second-pitfall silent drop risk (must be [])");
  } else {
    pass("dsh.client.inject is [] (roster-native plugin)");
  }
}

console.log(failures === 0 ? "\nALL GATES GREEN — package is install-safe." : `\n${failures} FAILURE(S) — DO NOT INSTALL.`);
process.exit(failures === 0 ? 0 : 1);
