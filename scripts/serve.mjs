/*
 * scripts/serve.mjs — tiny static server for the test harnesses.
 * Serves the package root's parent (D:\dsh-plugins) on 127.0.0.1:8123 so that
 * /dsh-skin-matrix-rain/test/*.html can load ../src/engine.js and ../lib/client.js.
 * Usage: node scripts/serve.mjs   (Ctrl+C to stop)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

http
  .createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    const f = path.resolve(path.join(root, u));
    if (f === root || f.startsWith(root + path.sep)) {
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, {
          "Content-Type": types[path.extname(f)] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(fs.readFileSync(f));
        return;
      }
    }
    res.writeHead(404);
    res.end("nf");
  })
  .listen(8123, "127.0.0.1", () => console.log("serving " + root + " on http://127.0.0.1:8123"));
