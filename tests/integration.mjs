// Uses a fresh OS temporary database. Never opens pocketbase/pb_data.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import net from "node:net";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = mkdtempSync(join(tmpdir(), "pb-crud-starter-test-"));
const binary = join(root, "pocketbase", process.platform === "win32" ? "pocketbase.exe" : "pocketbase");
const args = [`--dir=${dataDir}`, `--migrationsDir=${root}/pocketbase/pb_migrations`, `--hooksDir=${root}/pocketbase/pb_hooks`];
const password = randomBytes(18).toString("hex");
const testPort = await new Promise((resolvePort) => { const listener = net.createServer(); listener.listen(0, "127.0.0.1", () => { const port = listener.address().port; listener.close(() => resolvePort(port)); }); });
const base = `http://127.0.0.1:${testPort}`;
let server;
let logs = "";
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
function cli(command) {
  const result = spawnSync(binary, [...command, ...args], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0 || /^Error:/m.test(result.stdout + result.stderr)) throw new Error(result.stdout + result.stderr);
}
async function request(path, method = "GET", body, token) {
  const response = await fetch(base + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}
async function login(identity) {
  const result = await request("/api/collections/users/auth-with-password", "POST", { identity, password });
  check(result.status === 200, `login ${identity}`); return result.data;
}
async function cleanup() {
  if (server && server.exitCode === null) { const closed = new Promise((done) => server.once("exit", done)); server.kill(); await closed; }
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
try {
  cli(["migrate", "up"]); cli(["migrate", "up"]);
  cli(["superuser", "upsert", "bootstrap@example.test", password]);
  server = spawn(binary, ["serve", `--http=127.0.0.1:${testPort}`, `--publicDir=${root}/public`, "--indexFallback=false", ...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => { logs += chunk; }); server.stderr.on("data", (chunk) => { logs += chunk; });
  let ready = false;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/health")).ok) { ready = true; break; } } catch {} await new Promise((done) => setTimeout(done, 100)); }
  check(ready, "server ready");
  const superAuth = await request("/api/collections/_superusers/auth-with-password", "POST", { identity: "bootstrap@example.test", password });
  check(superAuth.status === 200, "bootstrap login");
  const su = superAuth.data.token;
  const accounts = {};
  for (const role of ["viewer", "editor", "admin"]) {
    const result = await request("/api/collections/users/records", "POST", { email: `${role}@example.test`, password, passwordConfirm: password, name: `Test ${role}`, role, active: true }, su);
    check(result.status === 200, `create ${role}`); accounts[role] = await login(`${role}@example.test`);
  }
  const itemPath = "/api/collections/items/records";
  const userPath = "/api/collections/users/records";
  const item = { title: "งานตัวอย่าง", description: "Synthetic data only", quantity: 2, due_date: "2026-09-20", status: "todo" };
  const guestList = await request(itemPath);
  check(guestList.status !== 200 || guestList.data.items.length === 0, "guests cannot list data");
  check((await request(itemPath, "POST", item)).status === 400, "guest writes denied");
  const created = await request(itemPath, "POST", item, accounts.editor.token);
  check(created.status === 200, "editor create");
  const id = created.data.id;
  check((await request(`${itemPath}/${id}`)).status === 404, "guest detail denied");
  for (const role of ["viewer", "editor", "admin"]) {
    check((await request(itemPath, "GET", undefined, accounts[role].token)).data.totalItems === 1, `${role} can list`);
    check((await request(`${itemPath}/${id}`, "GET", undefined, accounts[role].token)).status === 200, `${role} can read detail`);
  }
  for (const [method, path, body] of [["POST", itemPath, item], ["PATCH", `${itemPath}/${id}`, { title: "changed" }], ["DELETE", `${itemPath}/${id}`, undefined]]) {
    check((await request(path, method, body, accounts.viewer.token)).status >= 400, `viewer ${method} denied`);
  }
  check((await request(`${itemPath}/${id}`, "PATCH", { status: "doing", quantity: 5 }, accounts.editor.token)).data.quantity === 5, "editor update persists");
  for (const body of [{ ...item, due_date: "2026-02-30" }, { ...item, title: "   " }, { ...item, quantity: -1 }, { ...item, status: "unknown" }]) {
    check((await request(itemPath, "POST", body, accounts.editor.token)).status === 400, "invalid create rejected");
  }
  check((await request(`${itemPath}/${id}`, "PATCH", { due_date: "2026-02-30" }, accounts.editor.token)).status === 400, "invalid update rejected");
  for (const role of ["viewer", "editor"]) {
    check((await request(userPath, "GET", undefined, accounts[role].token)).data.totalItems === 1, `${role} cannot list team`);
    check((await request(`${userPath}/${accounts[role].record.id}`, "PATCH", { role: "admin" }, accounts[role].token)).status >= 400, `${role} cannot self-promote`);
    check((await request(`${userPath}/${accounts.viewer.record.id}`, "PATCH", { active: false }, accounts[role].token)).status >= 400, `${role} cannot manage member`);
  }
  check((await request(userPath, "GET", undefined, accounts.admin.token)).data.totalItems === 3, "admin lists team");
  check((await request(`${userPath}/${accounts.admin.record.id}`, "PATCH", { active: false }, accounts.admin.token)).status >= 400, "admin cannot deactivate self");
  check((await request(`${userPath}/${accounts.viewer.record.id}`, "PATCH", { verified: true }, accounts.admin.token)).status === 400, "admin sensitive fields denied");
  check((await request(`${userPath}/${accounts.viewer.record.id}`, "PATCH", { role: "editor", name: "Promoted member" }, accounts.admin.token)).status === 200, "admin promotion");
  const promotedItem = await request(itemPath, "POST", { ...item, title: "Promoted" }, accounts.viewer.token);
  check(promotedItem.status === 200, "existing token gets changed role from server");
  check((await request(`${userPath}/${accounts.viewer.record.id}`, "PATCH", { active: false }, accounts.admin.token)).status === 200, "admin disable");
  const disabledRead = await request(`${itemPath}/${id}`, "GET", undefined, accounts.viewer.token);
  check(disabledRead.status >= 400, "disabled old token cannot read");
  check((await request(itemPath, "POST", item, accounts.viewer.token)).status >= 400, "disabled old token cannot write");
  check((await request("/api/collections/users/auth-with-password", "POST", { identity: "viewer@example.test", password })).status >= 400, "disabled login rejected");
  check((await request(`${userPath}/${accounts.viewer.record.id}`, "PATCH", { active: true, role: "viewer" }, accounts.admin.token)).status === 200, "admin re-enable");
  const registration = await request("/api/starter/register", "POST", { name: "New member", email: "new@example.test", password, passwordConfirm: password, role: "admin", verified: true, active: false });
  check(registration.status === 201 && registration.data.role === "viewer" && registration.data.active, "registration forces active viewer");
  check((await request(userPath, "POST", { email: "bypass@example.test", password, passwordConfirm: password, role: "admin", active: true })).status >= 400, "generic registration locked");
  check((await request("/api/starter/register", "POST", { name: "Trap", email: "trap@example.test", password, passwordConfirm: password, website: "spam" })).status === 400, "honeypot blocked");
  check((await request(`${itemPath}/${promotedItem.data.id}`, "DELETE", undefined, accounts.admin.token)).status === 204, "admin delete");
  const disposable = await request(itemPath, "POST", item, accounts.admin.token);
  check(disposable.status === 200, "admin create");
  check((await request(`${itemPath}/${disposable.data.id}`, "PATCH", { status: "done" }, accounts.admin.token)).status === 200, "admin update");
  check((await request(`${itemPath}/${disposable.data.id}`, "DELETE", undefined, accounts.editor.token)).status === 204, "editor delete");
  for (let i = 0; i < 11; i++) await request(itemPath, "POST", { ...item, title: `ตัวอย่าง ${i + 1}`, status: i % 2 ? "doing" : "todo" }, accounts.editor.token);
  check((await request(`${itemPath}?page=2&perPage=10`, "GET", undefined, accounts.editor.token)).data.items.length === 2, "pagination");
  const filter = encodeURIComponent('title ~ "ตัวอย่าง" && status = "doing"');
  check((await request(`${itemPath}?filter=${filter}`, "GET", undefined, accounts.editor.token)).data.totalItems === 6, "search and status filter");
  for (const path of ["/", "/register.html", "/app.js", "/api.js", "/styles.css"]) check((await fetch(base + path)).status === 200, `public asset ${path}`);
  for (const path of ["/pocketbase/pb_data/data.db", "/pocketbase/pocketbase.exe", "/scripts/setup-pocketbase.ps1", "/.git/config"]) check((await fetch(base + path)).status === 404, `private path blocked ${path}`);
  console.log(`PASS: ${checks} API, authorization, validation, pagination and static-serving checks.`);
  if (process.argv.includes("--preview")) {
    console.log(JSON.stringify({ previewUrl: base, admin: "admin@example.test", editor: "editor@example.test", viewer: "viewer@example.test", password, temporary: true }));
    process.on("SIGINT", async () => { await cleanup(); process.exit(0); });
    process.on("SIGTERM", async () => { await cleanup(); process.exit(0); });
    await new Promise(() => {});
  }
} catch (error) { console.error(error.message); console.error(logs); process.exitCode = 1; }
finally { await cleanup(); }
