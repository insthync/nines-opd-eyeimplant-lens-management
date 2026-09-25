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
const dataDir = mkdtempSync(join(tmpdir(), "pb-eyeimplant-test-"));
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
  return { status: response.status, data: response.status === 204 ? null : await response.json().catch(() => null) };
}
async function login(identity) {
  const result = await request("/api/collections/users/auth-with-password", "POST", { identity, password });
  check(result.status === 200, `login ${identity}`); return result.data;
}
function localDate(offsetDays = 0) {
  const date = new Date(); date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const records = (collection) => `/api/collections/${collection}/records`;
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
  for (const role of ["viewer", "editor", "editor2", "admin"]) {
    const result = await request(records("users"), "POST", { email: `${role}@example.test`, password, passwordConfirm: password, name: `Test ${role}`, role: role === "editor2" ? "editor" : role, active: true }, su);
    check(result.status === 200, `create ${role}`); accounts[role] = await login(`${role}@example.test`);
  }

  // --- starter collection removed ------------------------------------------------
  check((await request(records("items"), "GET", undefined, accounts.editor.token)).status === 404, "starter items collection removed");

  // --- patients: role matrix and validation ---------------------------------------
  const patientBody = { hn: "hn001", name: "สมหญิง ใจดี", dob: "1980-05-01", sex: "female", active: true };
  const guestList = await request(records("patients"));
  check(guestList.status !== 200 || guestList.data.items.length === 0, "guests cannot list patients");
  check((await request(records("patients"), "POST", patientBody)).status === 400, "guest patient writes denied");
  const patient = (await request(records("patients"), "POST", patientBody, accounts.editor.token)).data;
  check(patient.hn === "HN001", "patient HN normalized to uppercase");
  check((await request(`${records("patients")}/${patient.id}`, "GET")).status === 404, "guest patient detail denied");
  for (const role of ["viewer", "editor", "editor2", "admin"]) {
    check((await request(records("patients"), "GET", undefined, accounts[role].token)).data.totalItems === 1, `${role} can list patients`);
    check((await request(`${records("patients")}/${patient.id}`, "GET", undefined, accounts[role].token)).status === 200, `${role} can read patient detail`);
  }
  check((await request(records("patients"), "POST", { ...patientBody, hn: "HN002" }, accounts.viewer.token)).status >= 400, "viewer patient create denied");
  check((await request(`${records("patients")}/${patient.id}`, "PATCH", { name: "แก้ไข" }, accounts.viewer.token)).status >= 400, "viewer patient update denied");
  check((await request(`${records("patients")}/${patient.id}`, "DELETE", undefined, accounts.viewer.token)).status >= 400, "viewer patient delete denied");
  check((await request(records("patients"), "POST", { ...patientBody, hn: "HN001", name: "ซ้ำ" }, accounts.editor.token)).status === 400, "duplicate HN rejected");
  check((await request(records("patients"), "POST", { ...patientBody, hn: "HN003", dob: "2026-02-30" }, accounts.editor.token)).status === 400, "impossible patient dob rejected");
  check((await request(`${records("patients")}/${patient.id}`, "PATCH", { dob: "2026-02-30" }, accounts.editor.token)).status === 400, "impossible dob update rejected");
  const patient2 = (await request(records("patients"), "POST", { ...patientBody, hn: "HN002", name: "สมชาย มานี" }, accounts.admin.token)).data;
  check(patient2.id, "admin patient create");

  // --- master data -----------------------------------------------------------------
  const vendor = (await request(records("vendors"), "POST", { name: "ไอคอน เมดิคอล", contact_name: "คุณแพร", phone: "021234567", active: true }, accounts.editor.token)).data;
  check(vendor.id, "vendor create");
  check((await request(records("vendors"), "POST", { name: "ไอคอน เมดิคอล" }, accounts.editor.token)).status === 400, "duplicate vendor name rejected");
  const doctor = (await request(records("doctors"), "POST", { name: "นพ. ปิยะ มานะษา", department: "จักษุแพทย์", active: true }, accounts.editor.token)).data;
  const procedure = (await request(records("procedures"), "POST", { name: "Phaco + IOL Implantation", category: "Cataract", active: true }, accounts.editor.token)).data;
  check(doctor.id && procedure.id, "doctor and procedure create");
  const implantBody = { product_code: "iol-std-22", implant_type: "standard_iol", brand: "AcrySof", manufacturer: "Alcon", model: "IQ", power: "+22.0 D", unit_price: 4500, min_stock: 2, active: true };
  const implant = (await request(records("implants"), "POST", implantBody, accounts.editor.token)).data;
  check(implant.product_code === "IOL-STD-22", "implant code normalized to uppercase");
  check((await request(records("implants"), "POST", implantBody, accounts.editor.token)).status === 400, "duplicate product code rejected");
  const implantToric = (await request(records("implants"), "POST", { ...implantBody, product_code: "IOL-TORIC-21", implant_type: "toric_iol", power: "+21.0 D", cylinder: "+1.25 D", unit_price: 6800, min_stock: 1 }, accounts.editor.token)).data;
  check(implantToric.id, "second implant create");

  // --- surgery cases -----------------------------------------------------------------
  const caseBody = { patient: patient.id, surgery_date: localDate(1), surgery_time: "09:30", eye: "os", surgeon: doctor.id, procedure: procedure.id, priority: "urgent", diagnosis: "Cataract OS" };
  check((await request(records("surgery_cases"), "POST", caseBody, accounts.viewer.token)).status >= 400, "viewer case create denied");
  check((await request(records("surgery_cases"), "POST", { ...caseBody, eye: "left" }, accounts.editor.token)).status === 400, "free-text eye rejected (dropdown only)");
  check((await request(records("surgery_cases"), "POST", { ...caseBody, surgery_date: "2026-02-30" }, accounts.editor.token)).status === 400, "impossible surgery date rejected");
  const surgeryCase = (await request(records("surgery_cases"), "POST", caseBody, accounts.editor.token)).data;
  check(/^EYE-\d{6}-\d{4}$/.test(surgeryCase.case_number || ""), "case number auto-generated EYE-YYYYMM-NNNN");
  check(surgeryCase.status === "draft", "new case starts as draft");
  check(surgeryCase.created_by === accounts.editor.record.id, "case created_by stamped from auth");
  const surgeryCase2 = (await request(records("surgery_cases"), "POST", { ...caseBody, patient: patient2.id, eye: "od", surgery_date: localDate(3) }, accounts.editor2.token)).data;
  check(surgeryCase2.case_number !== surgeryCase.case_number, "case numbers unique");
  check((await request(`${records("surgery_cases")}/${surgeryCase.id}`, "PATCH", { diagnosis: "Cataract OS grade 3" }, accounts.editor.token)).status === 200, "draft case fields editable");
  check((await request(`${records("surgery_cases")}/${surgeryCase.id}`, "PATCH", { status: "confirmed" }, accounts.editor.token)).status === 400, "case status cannot be PATCHed directly");

  // --- reservations + two-person verification -------------------------------------------
  const reservation = (await request(records("reservations"), "POST", { case: surgeryCase.id, implant: implant.id, quantity: 1 }, accounts.editor.token)).data;
  check(/^RES-\d{6}-\d{4}$/.test(reservation.reservation_number || ""), "reservation number auto-generated RES-YYYYMM-NNNN");
  check(reservation.status === "draft" && reservation.power_snapshot === "+22.0 D", "reservation snapshots power from implant master");
  check((await request(`${records("reservations")}/${reservation.id}`, "PATCH", { quantity: 2 }, accounts.editor.token)).status === 200, "draft reservation editable");
  check((await request("/api/eyeimplant/confirm", "POST", { reservation: reservation.id }, accounts.editor.token)).status === 400, "confirm rejected before two-person verification");
  check((await request("/api/eyeimplant/verify", "POST", { reservation: reservation.id, stage: "first" }, accounts.viewer.token)).status === 403, "viewer cannot perform verification");
  check((await request("/api/eyeimplant/verify", "POST", { reservation: reservation.id, stage: "second" }, accounts.editor.token)).status === 400, "second check rejected before first check");
  check((await request("/api/eyeimplant/verify", "POST", { reservation: reservation.id, stage: "first" }, accounts.editor.token)).status === 200, "first check by editor");
  check((await request(`${records("reservations")}/${reservation.id}`, "PATCH", { quantity: 1 }, accounts.editor.token)).status >= 400, "reservation locked after first check");
  check((await request("/api/eyeimplant/verify", "POST", { reservation: reservation.id, stage: "second" }, accounts.editor.token)).status === 400, "same person cannot be both checkers");
  check((await request("/api/eyeimplant/verify", "POST", { reservation: reservation.id, stage: "second" }, accounts.editor2.token)).status === 200, "second check by a different editor");
  const reservationDetail = (await request(`${records("reservations")}/${reservation.id}`, "GET", undefined, accounts.editor.token)).data;
  check(reservationDetail.status === "verified" && reservationDetail.first_checker === accounts.editor.record.id && reservationDetail.second_checker === accounts.editor2.record.id, "verification records both checkers");
  check((await request("/api/eyeimplant/or-verify", "POST", { case: surgeryCase.id }, accounts.editor.token)).status === 400, "OR verify rejected before confirmation");

  // --- confirm blocked without stock, then receive stock and confirm ----------------------
  const noStock = await request("/api/eyeimplant/confirm", "POST", { reservation: reservation.id }, accounts.editor.token);
  check(noStock.status === 400 && /IOL-STD-22/.test(noStock.data?.message || ""), "out-of-stock confirm names the product code");
  check((await request("/api/eyeimplant/receive", "POST", { implant: implant.id, quantity: 0 }, accounts.editor.token)).status === 400, "receive rejects zero quantity");
  const lot = (await request("/api/eyeimplant/receive", "POST", { implant: implant.id, lot: "L2609A", expiry: localDate(400), quantity: 2, location: "ตู้แช่ A1" }, accounts.editor.token)).data;
  check(lot.id, "stock received");
  const lotAfterReceive = (await request(`${records("stock_lots")}/${lot.id}`, "GET", undefined, accounts.editor.token)).data;
  check(lotAfterReceive.qty_physical === 2 && lotAfterReceive.qty_reserved === 0, "received lot quantities correct");
  const lotMerged = (await request("/api/eyeimplant/receive", "POST", { implant: implant.id, lot: "L2609A", expiry: localDate(400), quantity: 1, location: "ตู้แช่ A1" }, accounts.editor.token)).data;
  check(lotMerged.id === lot.id, "receiving an existing lot merges into the same row");
  check((await request(`${records("stock_lots")}/${lot.id}`, "GET", undefined, accounts.editor.token)).data.qty_physical === 3, "merged lot physical quantity");
  check((await request(`${records("stock_lots")}/${lot.id}`, "PATCH", { qty_reserved: 5 }, accounts.editor.token)).status === 400, "direct qty_reserved writes rejected");
  const confirmed = (await request("/api/eyeimplant/confirm", "POST", { reservation: reservation.id }, accounts.editor.token)).data;
  check(confirmed.status === "confirmed" && confirmed.lot === lot.id, "reservation confirmed against received lot");
  const lotReserved = (await request(`${records("stock_lots")}/${lot.id}`, "GET", undefined, accounts.editor.token)).data;
  check(lotReserved.qty_physical === 3 && lotReserved.qty_reserved === 2, "confirm reserves stock (quantity 2)");
  check((await request(`${records("surgery_cases")}/${surgeryCase.id}`, "GET", undefined, accounts.editor.token)).data.status === "confirmed", "case confirmed by reservation workflow");
  check((await request("/api/eyeimplant/confirm", "POST", { reservation: reservation.id }, accounts.editor.token)).status === 400, "double confirm rejected");
  check((await request(`${records("surgery_cases")}/${surgeryCase.id}`, "PATCH", { eye: "od" }, accounts.editor.token)).status === 400, "eye locked after confirmation");
  check((await request(`${records("surgery_cases")}/${surgeryCase.id}`, "PATCH", { patient: patient2.id }, accounts.editor.token)).status === 400, "patient locked after confirmation");
  check((await request(`${records("surgery_cases")}/${surgeryCase.id}`, "PATCH", { notes: "เตรียมห้อง OR 1" }, accounts.editor.token)).status === 200, "non-critical fields still editable");

  // --- OR verification and usage ----------------------------------------------------------
  check((await request("/api/eyeimplant/use", "POST", { reservation: reservation.id }, accounts.editor.token)).status === 400, "usage rejected before OR verification");
  check((await request("/api/eyeimplant/or-verify", "POST", { case: surgeryCase.id }, accounts.editor.token)).status === 200, "OR verified");
  check((await request("/api/eyeimplant/or-verify", "POST", { case: surgeryCase.id }, accounts.editor.token)).status === 400, "double OR verify rejected");
  const used = (await request("/api/eyeimplant/use", "POST", { reservation: reservation.id, serial: "SN-001", remark: "ใช้จริงตามแผน" }, accounts.editor.token)).data;
  check(used.id && used.caseStatus === "completed", "implant used and case completed");
  const lotAfterUse = (await request(`${records("stock_lots")}/${lot.id}`, "GET", undefined, accounts.editor.token)).data;
  check(lotAfterUse.qty_physical === 1 && lotAfterUse.qty_reserved === 0, "usage deducts physical stock and releases reservation");
  const usageList = await request(`${records("implant_usages")}?filter=${encodeURIComponent(`reservation = "${reservation.id}"`)}`, "GET", undefined, accounts.viewer.token);
  check(usageList.data.totalItems === 1 && usageList.data.items[0].lot === "L2609A" && usageList.data.items[0].serial === "SN-001" && usageList.data.items[0].power === "+22.0 D", "usage record captures lot/serial/power");
  check((await request(`${records("implant_usages")}/${usageList.data.items[0].id}`, "DELETE", undefined, accounts.admin.token)).status >= 400, "usage records cannot be deleted");
  check((await request(records("implant_usages"), "POST", { case: surgeryCase.id, patient: patient.id, implant: implant.id }, accounts.admin.token)).status >= 400, "usage records cannot be created directly");
  check((await request(`${records("surgery_cases")}/${surgeryCase.id}`, "PATCH", { notes: "แก้ทีหลัง" }, accounts.editor.token)).status === 400, "completed case locked");

  // --- traceability both directions --------------------------------------------------------
  check((await request(`${records("implant_usages")}?filter=${encodeURIComponent(`patient = "${patient.id}"`)}`, "GET", undefined, accounts.editor.token)).data.totalItems === 1, "trace patient -> implant");
  check((await request(`${records("implant_usages")}?filter=${encodeURIComponent(`lot = "L2609A"`)}`, "GET", undefined, accounts.editor.token)).data.totalItems === 1, "trace lot -> patients (recall)");
  check((await request(`${records("implant_usages")}?filter=${encodeURIComponent(`implant = "${implant.id}"`)}`, "GET", undefined, accounts.editor.token)).data.totalItems === 1, "trace implant -> usage");

  // --- cancellation releases reserved stock -------------------------------------------------
  const reservation2 = (await request(records("reservations"), "POST", { case: surgeryCase2.id, implant: implantToric.id, quantity: 1 }, accounts.editor.token)).data;
  await request("/api/eyeimplant/verify", "POST", { reservation: reservation2.id, stage: "first" }, accounts.editor2.token);
  await request("/api/eyeimplant/verify", "POST", { reservation: reservation2.id, stage: "second" }, accounts.editor.token);
  check((await request(`${records("reservations")}/${reservation2.id}`, "GET", undefined, accounts.editor.token)).data.status === "verified", "reservation2 verified by swapped checkers");
  const lot2 = (await request("/api/eyeimplant/receive", "POST", { implant: implantToric.id, lot: "TOR-77", expiry: localDate(200), quantity: 1 }, accounts.editor.token)).data;
  await request("/api/eyeimplant/confirm", "POST", { reservation: reservation2.id }, accounts.editor.token);
  check((await request(`${records("stock_lots")}/${lot2.id}`, "GET", undefined, accounts.editor.token)).data.qty_reserved === 1, "toric lot reserved");
  check((await request("/api/eyeimplant/cancel-reservation", "POST", { reservation: reservation2.id }, accounts.editor.token)).status === 400, "cancel requires a reason");
  check((await request("/api/eyeimplant/cancel-reservation", "POST", { reservation: reservation2.id, reason: "เปลี่ยน Power ตามการคำนวณใหม่" }, accounts.editor.token)).status === 200, "confirmed reservation cancelled");
  check((await request(`${records("stock_lots")}/${lot2.id}`, "GET", undefined, accounts.editor.token)).data.qty_reserved === 0, "cancellation releases reserved stock");
  check((await request(`${records("surgery_cases")}/${surgeryCase2.id}`, "GET", undefined, accounts.editor.token)).data.status === "draft", "case returns to draft when no active reservations remain");

  // --- expired lot and wrong-lot protection -------------------------------------------------
  const reservation3 = (await request(records("reservations"), "POST", { case: surgeryCase2.id, implant: implant.id, quantity: 1 }, accounts.editor.token)).data;
  await request("/api/eyeimplant/verify", "POST", { reservation: reservation3.id, stage: "first" }, accounts.editor.token);
  await request("/api/eyeimplant/verify", "POST", { reservation: reservation3.id, stage: "second" }, accounts.editor2.token);
  const expiredLot = (await request("/api/eyeimplant/receive", "POST", { implant: implant.id, lot: "OLD-99", expiry: localDate(-10), quantity: 1 }, accounts.editor.token)).data;
  check(expiredLot.id, "expired lot can be recorded for audit");
  check((await request("/api/eyeimplant/confirm", "POST", { reservation: reservation3.id, lot: expiredLot.id }, accounts.editor.token)).status === 400, "expired lot blocked from confirmation");
  check((await request("/api/eyeimplant/confirm", "POST", { reservation: reservation3.id }, accounts.editor.token)).status === 200, "auto-pick skips expired lot and confirms from valid stock");

  // --- cancel whole case ----------------------------------------------------------------------
  const case3 = (await request(records("surgery_cases"), "POST", { ...caseBody, patient: patient2.id, eye: "ou", surgery_date: localDate(10) }, accounts.editor2.token)).data;
  const reservation4 = (await request(records("reservations"), "POST", { case: case3.id, implant: implantToric.id, quantity: 1 }, accounts.editor.token)).data;
  check((await request("/api/eyeimplant/cancel-case", "POST", { case: case3.id }, accounts.editor.token)).status === 400, "cancel case requires a reason");
  check((await request("/api/eyeimplant/cancel-case", "POST", { case: surgeryCase.id, reason: "จบแล้ว" }, accounts.editor.token)).status === 400, "completed case cannot be cancelled");
  check((await request("/api/eyeimplant/cancel-case", "POST", { case: case3.id, reason: "ผู้ป่วยเลื่อนวันผ่าตัด" }, accounts.editor.token)).status === 200, "case cancelled");
  check((await request(`${records("surgery_cases")}/${case3.id}`, "GET", undefined, accounts.editor.token)).data.status === "cancelled", "case status cancelled");
  check((await request(`${records("reservations")}/${reservation4.id}`, "GET", undefined, accounts.editor.token)).data.status === "cancelled", "case cancellation also cancels its reservations");
  check((await request(`${records("surgery_cases")}/${case3.id}`, "PATCH", { notes: "x" }, accounts.editor.token)).status === 400, "cancelled case locked");
  check((await request(records("reservations"), "POST", { case: case3.id, implant: implant.id, quantity: 1 }, accounts.editor.token)).status === 400, "reservations rejected on cancelled case");

  // --- audit log --------------------------------------------------------------------------------
  const logsList = await request(records("case_logs"), "GET", undefined, accounts.viewer.token);
  check(logsList.data.totalItems >= 10, "workflow writes an audit trail");
  check((await request(records("case_logs"), "POST", { action: "fake" }, accounts.admin.token)).status >= 400, "audit log writes are server-only");

  // --- member management (kept from starter) ----------------------------------------------------
  const userPath = records("users");
  for (const role of ["viewer", "editor", "editor2"]) {
    check((await request(userPath, "GET", undefined, accounts[role].token)).data.totalItems === 1, `${role} cannot list team`);
    check((await request(`${userPath}/${accounts[role].record.id}`, "PATCH", { role: "admin" }, accounts[role].token)).status >= 400, `${role} cannot self-promote`);
  }
  check((await request(`${userPath}/${accounts.viewer.record.id}`, "PATCH", { active: false }, accounts.editor.token)).status >= 400, "editor cannot manage member");
  check((await request(userPath, "GET", undefined, accounts.admin.token)).data.totalItems === 4, "admin lists team");
  check((await request(`${userPath}/${accounts.admin.record.id}`, "PATCH", { active: false }, accounts.admin.token)).status >= 400, "admin cannot deactivate self");
  check((await request(`${userPath}/${accounts.viewer.record.id}`, "PATCH", { verified: true }, accounts.admin.token)).status === 400, "admin sensitive fields denied");
  check((await request(`${userPath}/${accounts.viewer.record.id}`, "PATCH", { role: "editor", name: "Promoted member" }, accounts.admin.token)).status === 200, "admin promotion");
  check((await request(records("patients"), "POST", { ...patientBody, hn: "HN900" }, accounts.viewer.token)).status === 200, "existing token gets changed role from server");
  check((await request(`${userPath}/${accounts.viewer.record.id}`, "PATCH", { active: false }, accounts.admin.token)).status === 200, "admin disable");
  check((await request(`${records("patients")}/${patient.id}`, "GET", undefined, accounts.viewer.token)).status >= 400, "disabled old token cannot read");
  check((await request(records("patients"), "POST", { ...patientBody, hn: "HN901" }, accounts.viewer.token)).status >= 400, "disabled old token cannot write");
  check((await request("/api/collections/users/auth-with-password", "POST", { identity: "viewer@example.test", password })).status >= 400, "disabled login rejected");
  check((await request(`${userPath}/${accounts.viewer.record.id}`, "PATCH", { active: true, role: "viewer" }, accounts.admin.token)).status === 200, "admin re-enable");

  // --- registration (renamed route, same guarantees) ----------------------------------------------
  const registration = await request("/api/eyeimplant/register", "POST", { name: "New member", email: "new@example.test", password, passwordConfirm: password, role: "admin", verified: true, active: false });
  check(registration.status === 201 && registration.data.role === "viewer" && registration.data.active, "registration forces active viewer");
  check((await request(userPath, "POST", { email: "bypass@example.test", password, passwordConfirm: password, role: "admin", active: true })).status >= 400, "generic registration locked");
  check((await request("/api/eyeimplant/register", "POST", { name: "Trap", email: "trap@example.test", password, passwordConfirm: password, website: "spam" })).status === 400, "honeypot blocked");

  // --- pagination and search ------------------------------------------------------------------------
  for (let i = 0; i < 11; i++) await request(records("patients"), "POST", { ...patientBody, hn: `P101${String(i).padStart(2, "0")}`, name: `ผู้ป่วยทดสอบ ${i + 1}` }, accounts.editor.token);
  check((await request(`${records("patients")}?page=2&perPage=10&sort=created`, "GET", undefined, accounts.editor.token)).data.items.length === 4, "pagination");
  const nameFilter = encodeURIComponent('name ~ "ผู้ป่วยทดสอบ"');
  check((await request(`${records("patients")}?filter=${nameFilter}`, "GET", undefined, accounts.editor.token)).data.totalItems === 11, "name search filter");
  const dateFilter = encodeURIComponent(`surgery_date >= "${localDate(0)}"`);
  check((await request(`${records("surgery_cases")}?filter=${dateFilter}`, "GET", undefined, accounts.editor.token)).data.totalItems >= 2, "surgery date filter");

  // --- static serving and private paths ---------------------------------------------------------------
  for (const asset of ["/", "/register.html", "/app.js", "/api.js", "/styles.css", "/ui.js", "/config.js"]) check((await fetch(base + asset)).status === 200, `public asset ${asset}`);
  for (const privatePath of ["/pocketbase/pb_data/data.db", "/pocketbase/pocketbase.exe", "/scripts/setup-pocketbase.ps1", "/.git/config"]) check((await fetch(base + privatePath)).status === 404, `private path blocked ${privatePath}`);

  console.log(`PASS: ${checks} API, authorization, workflow, validation, traceability and static-serving checks.`);
  if (process.argv.includes("--preview")) {
    await seedDemoData(su, accounts);
    console.log(JSON.stringify({ previewUrl: base, admin: "admin@example.test", editor: "editor@example.test", editor2: "editor2@example.test", viewer: "viewer@example.test", password, temporary: true }));
    process.on("SIGINT", async () => { await cleanup(); process.exit(0); });
    process.on("SIGTERM", async () => { await cleanup(); process.exit(0); });
    await new Promise(() => {});
  }
} catch (error) { console.error(error.message); console.error(logs); process.exitCode = 1; }
finally { await cleanup(); }

// Demo data for --preview only: synthetic patients/masters/stock/cases covering
// every workflow state so the UI can be explored in a browser.
async function seedDemoData(su, accounts) {
  const create = async (collection, body, token = su) => (await request(records(collection), "POST", body, token)).data;
  const editorToken = accounts.editor.token;
  const editor2Token = accounts.editor2.token;
  const vendorA = await create("vendors", { name: "ไอคอน เมดิคอล ซัพพลาย", contact_name: "คุณแพรวา", phone: "021234567", email: "sales@iconmedical.example", active: true });
  const vendorB = await create("vendors", { name: "โอปโต้ ไทยแลนด์", contact_name: "คุณธนา", phone: "028765432", active: true });
  const doctors = [];
  for (const [name, department] of [["นพ. ปิยะ มานะษา", "จักษุแพทย์ ต้อกระจก"], ["พญ. วรรณา ตาชัด", "จักษุแพทย์ จอตก"], ["นพ. สมชาย ใจดี", "จักษุแพทย์ ต้อหิน"]]) {
    doctors.push(await create("doctors", { name, department, active: true }));
  }
  const procedures = [];
  for (const [name, category] of [["Phaco + IOL Implantation", "Cataract"], ["Phaco + Toric IOL", "Cataract"], ["Trabeculectomy + Ahmed Valve", "Glaucoma"], ["PPV + Silicon Oil", "Retina"]]) {
    procedures.push(await create("procedures", { name, category, active: true }));
  }
  const patients = [];
  const patientNames = ["สมหญิง ใจดี", "สมชาย มานะ", "วิภา แสงใส", "ธนกฤต รุ่งเรือง", "พรทิพย์ ศรีสุข", "อนันต์ พูนสุข", "มาลี ขาวสะอาด", "ประเสริฐ ทองดี", "จิราภรณ์ แจ่มใส", "กิตติ ชื่นจิต", "สุนีย์ บุญมี", "ณัฐพล ว่องไว"];
  for (let i = 0; i < patientNames.length; i++) {
    patients.push(await create("patients", { hn: `62${String(1001 + i)}`, name: patientNames[i], dob: `19${50 + (i % 20)}-0${1 + (i % 9)}-1${i % 9}`, sex: i % 2 ? "male" : "female", phone: `08${1 + (i % 9)}1234567`, allergies: i % 5 === 0 ? "Penicillin" : "", active: true }));
  }
  const implantDefs = [
    ["IOL-STD-20D", "standard_iol", "AcrySof", "Alcon", "IQ", "+20.0 D", "", 4200, 2, vendorA.id],
    ["IOL-STD-21D", "standard_iol", "AcrySof", "Alcon", "IQ", "+21.0 D", "", 4200, 2, vendorA.id],
    ["IOL-STD-22D", "standard_iol", "AcrySof", "Alcon", "IQ", "+22.0 D", "", 4200, 2, vendorA.id],
    ["IOL-STD-23D", "standard_iol", "AcrySof", "Alcon", "IQ", "+23.0 D", "", 4200, 2, vendorA.id],
    ["IOL-TORIC-21T2", "toric_iol", "Tecnis", "J&J", "Toric II", "+21.0 D", "+1.50 D", 6900, 1, vendorB.id],
    ["IOL-MF-20D", "multifocal_iol", "PanOptix", "Alcon", "Vivity", "+20.0 D", "", 11500, 1, vendorA.id],
    ["GLA-AHMED-FP7", "glaucoma_implant", "Ahmed", "New World Medical", "FP7", "", "", 28000, 1, vendorB.id],
    ["RET-SILICONE-5000", "retinal_implant", "Silicone Oil", "Arcadophta", "5000 cst", "", "", 9800, 1, vendorB.id],
  ];
  const implants = [];
  for (const [code, type, brand, manufacturer, model, power, cylinder, price, minStock, vendor] of implantDefs) {
    implants.push(await create("implants", { product_code: code, implant_type: type, brand, manufacturer, model, power, cylinder, unit_price: price, min_stock: minStock, max_stock: 20, vendor, lot_control: true, serial_control: type.includes("glaucoma"), expiry_control: true, active: true }));
  }
  const receive = (implantId, lot, expiryOffset, quantity, location) => request("/api/eyeimplant/receive", "POST", { implant: implantId, lot, expiry: expiryOffset === null ? "" : localDate(expiryOffset), quantity, location }, editorToken);
  await receive(implants[0].id, "L2601A", 500, 3, "ตู้แช่ A1");
  await receive(implants[1].id, "L2602B", 30, 2, "ตู้แช่ A1");
  await receive(implants[2].id, "L2603C", 200, 2, "ตู้แช่ A2");
  await receive(implants[4].id, "TOR-88", 300, 1, "ตู้แช่ B1");
  await receive(implants[6].id, "GLA-01", 300, 1, "ตู้แช่ B2");
  await receive(implants[7].id, "OLD-SO", -30, 1, "ตู้แช่ B2");
  const verify = (reservationId, stage, token) => request("/api/eyeimplant/verify", "POST", { reservation: reservationId, stage }, token);
  const confirm = (reservationId) => request("/api/eyeimplant/confirm", "POST", { reservation: reservationId }, editorToken);
  const newCase = async (index, dateOffset, eye, extras = {}) => create("surgery_cases", { patient: patients[index].id, surgery_date: localDate(dateOffset), surgery_time: `${String(8 + (index % 6)).padStart(2, "0")}:30`, eye, surgeon: doctors[index % 3].id, procedure: procedures[index % 4].id, diagnosis: "Cataract", or_room: `OR${1 + (index % 2)}`, priority: index % 4 === 0 ? "urgent" : "normal", ...extras }, editorToken);
  // Case ready for surgery today: fully confirmed + OR verified.
  const readyCase = await newCase(0, 0, "od");
  const readyReservation = await create("reservations", { case: readyCase.id, implant: implants[0].id, quantity: 1 }, editorToken);
  await verify(readyReservation.id, "first", editorToken);
  await verify(readyReservation.id, "second", editor2Token);
  await confirm(readyReservation.id);
  await request("/api/eyeimplant/or-verify", "POST", { case: readyCase.id }, editor2Token);
  // Problem case tomorrow: no reservation yet.
  await newCase(1, 1, "os");
  // Pending case this week: verified reservation waiting for confirmation.
  const pendingCase = await newCase(2, 4, "od");
  const pendingReservation = await create("reservations", { case: pendingCase.id, implant: implants[1].id, quantity: 1 }, editorToken);
  await verify(pendingReservation.id, "first", editor2Token);
  await verify(pendingReservation.id, "second", editorToken);
  // Early case next week: draft reservation only.
  const earlyCase = await newCase(3, 9, "ou");
  await create("reservations", { case: earlyCase.id, implant: implants[4].id, quantity: 1 }, editor2Token);
  // Completed history case from last week with usage.
  const doneCase = await newCase(4, -6, "os");
  const doneReservation = await create("reservations", { case: doneCase.id, implant: implants[2].id, quantity: 1 }, editorToken);
  await verify(doneReservation.id, "first", editorToken);
  await verify(doneReservation.id, "second", editor2Token);
  await confirm(doneReservation.id);
  await request("/api/eyeimplant/or-verify", "POST", { case: doneCase.id }, editor2Token);
  await request("/api/eyeimplant/use", "POST", { reservation: doneReservation.id, serial: "SN-DEMO-001" }, editorToken);
  // Cancelled case.
  const cancelledCase = await newCase(5, 2, "od");
  await request("/api/eyeimplant/cancel-case", "POST", { case: cancelledCase.id, reason: "ผู้ป่วยติดเชื้อ เลื่อนวันผ่าตัด" }, editorToken);
  // Toric case verified but on the expiring-soon lot, to exercise the warning UI.
  const toricCase = await newCase(6, 5, "od", { procedure: procedures[1].id, diagnosis: "Cataract with astigmatism" });
  const toricReservation = await create("reservations", { case: toricCase.id, implant: implants[1].id, quantity: 1 }, editorToken);
  await verify(toricReservation.id, "first", editor2Token);
  await verify(toricReservation.id, "second", editorToken);
  await confirm(toricReservation.id);
}
