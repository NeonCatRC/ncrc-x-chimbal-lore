// Cache-busting + precompression for static app assets.
// - appends ?v=<sha1-8> to js/css refs in index.html (so they can be cached
//   immutable; the query changes only when the file changes)
// - writes a gzip -9 sibling (.gz) for nginx gzip_static
// Idempotent: re-running just refreshes the hashes. Part of `npm run build`.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const ASSETS = [
  "css/styles.css",
  "css/fonts.css",
  "js/vendor/react.production.min.js",
  "js/vendor/react-dom.production.min.js",
  "js/annotations.js",
  "js/requests.js",
  "js/build/starfield.js",
  "js/build/archive.js",
];

const htmlPath = path.join(ROOT, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");

for (const rel of ASSETS) {
  const abs = path.join(ROOT, rel);
  const buf = fs.readFileSync(abs);
  const hash = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 8);
  fs.writeFileSync(abs + ".gz", zlib.gzipSync(buf, { level: 9 }));

  const esc = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("([\"'])" + esc + "(?:\\?v=[a-f0-9]+)?\\1", "g");
  const next = html.replace(re, "$1" + rel + "?v=" + hash + "$1");
  if (next === html) console.warn("WARN: ref not found in index.html:", rel);
  html = next;
}

fs.writeFileSync(htmlPath, html);
console.log("build-hash: versioned + gzipped", ASSETS.length, "assets");
