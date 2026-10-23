const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src", "index.js"), "utf8");
const spec = yaml.load(fs.readFileSync(path.join(root, "openapi.yaml"), "utf8"));
const code = [...source.matchAll(/app\.(get|post|put|delete)\("(\/api\/[^" ]+)"/g)]
  .map((match) => `${match[1]} ${match[2].replace(/:([^/]+)/g, "{$1}")}`).sort();
const documented = Object.entries(spec.paths).flatMap(([route, operations]) =>
  Object.keys(operations).filter((method) => ["get", "post", "put", "delete"].includes(method)).map((method) => `${method} ${route}`)).sort();
const missing = code.filter((route) => !documented.includes(route));
const extra = documented.filter((route) => !code.includes(route));
if (missing.length || extra.length) throw new Error(`OpenAPI mismatch: missing=${missing.join(",")} extra=${extra.join(",")}`);
for (const [route, operations] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(operations)) {
    if (!["post", "put", "delete"].includes(method) || route === "/api/auth/login") continue;
    if (!operation.security || !operation.responses["401"] || (method === "delete" && !operation.responses["403"])) throw new Error(`Missing auth contract: ${method} ${route}`);
  }
}
console.log(`PASS OpenAPI: ${documented.length} paths/methods match code, write operations document auth errors`);
