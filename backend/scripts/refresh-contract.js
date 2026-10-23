const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const root = path.join(__dirname, "..");
const yamlFile = path.join(root, "openapi.yaml");
const postmanFile = path.join(root, "postman_collection.json");

// เติม error ที่ auth middleware ส่งได้ให้ทุก operation ที่เขียนข้อมูล
const spec = yaml.load(fs.readFileSync(yamlFile, "utf8"));
for (const methods of Object.values(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!["post", "put", "patch", "delete"].includes(method) || !operation || !operation.responses || operation.operationId === "login") continue;
    operation.security = [{ bearerAuth: [] }];
    operation.responses["401"] = { $ref: "#/components/responses/Unauthorized" };
    if (method === "delete") operation.responses["403"] = { $ref: "#/components/responses/Forbidden" };
  }
}
// mysql2 คืน DECIMAL เป็น string; DATE ตั้งค่าให้คืน YYYY-MM-DD โดยไม่เปลี่ยนวัน
const schemas = spec.components.schemas;
schemas.Gym = { type: "object", properties: { ...schemas.GymInput.properties,
  monthly_fee: { type: "string", example: "1500.00" }, id: { type: "integer" },
  created_at: { type: "string", format: "date-time" }, updated_at: { type: "string", format: "date-time" } } };
schemas.Member = { type: "object", properties: { ...schemas.MemberInput.properties,
  join_date: { type: "string", format: "date" }, id: { type: "integer" },
  created_at: { type: "string", format: "date-time" }, updated_at: { type: "string", format: "date-time" } } };
schemas.Membership = { type: "object", properties: { ...schemas.MembershipInput.properties,
  start_date: { type: "string", format: "date" }, end_date: { type: "string", format: "date" },
  id: { type: "integer" }, created_at: { type: "string", format: "date-time" },
  updated_at: { type: "string", format: "date-time" } } };
fs.writeFileSync(yamlFile, yaml.dump(spec, { lineWidth: 110, noRefs: true }), "utf8");

const collection = JSON.parse(fs.readFileSync(postmanFile, "utf8"));
collection.info.name = "Gym Membership Management API — Phase 3";
const authNote = "Phase 3: POST/PUT require staff or admin JWT; DELETE requires admin JWT.";
if (!collection.info.description.includes(authNote)) collection.info.description += `\n${authNote}`;
if (!collection.variable.some((v) => v.key === "token")) collection.variable.push({ key: "token", value: "", type: "string" });
const authGroup = { name: "Auth", item: [
  { name: "POST Login (saves token)", request: { method: "POST", header: [{ key: "Content-Type", value: "application/json" }], body: { mode: "raw", raw: JSON.stringify({ email: "staff@fitlife.local", password: "<enter local password>" }) }, url: "{{baseUrl}}/api/auth/login" }, event: [{ listen: "test", script: { type: "text/javascript", exec: ["if (pm.response.code === 200) pm.collectionVariables.set('token', pm.response.json().token);"] } }] },
  { name: "GET Current User", request: { method: "GET", auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] }, url: "{{baseUrl}}/api/auth/me" } },
] };
collection.item = collection.item.filter((item) => item.name !== "Auth");
collection.item.unshift(authGroup);
function attachAuth(items) {
  for (const item of items) {
    if (item.item) attachAuth(item.item);
    if (item.request && ["POST", "PUT", "PATCH", "DELETE"].includes(item.request.method) && !String(item.request.url.raw || item.request.url).includes("/auth/login")) {
      item.request.auth = { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] };
    }
  }
}
attachAuth(collection.item);
fs.writeFileSync(postmanFile, JSON.stringify(collection, null, 2) + "\n", "utf8");
console.log("Updated OpenAPI auth responses and Postman bearer requests");
