// API rules authorize requests. These hooks add field-level business rules:
// ID generation, calendar-date checks, change control after confirmation and
// protection of workflow-owned fields such as stock qty_reserved.
//
// NOTE: PocketBase re-evaluates JSVM callbacks in their own context, so every
// callback below is fully self-contained (helpers defined inside).

// --- users: admin may only edit display fields --------------------------------
onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const allowed = ["name", "role", "active"];
    const body = e.requestInfo().body || {};
    if (Object.keys(body).some((key) => allowed.indexOf(key) === -1)) {
      throw new BadRequestError("แก้ไขได้เฉพาะชื่อ สิทธิ์ และสถานะบัญชี");
    }
  }
  e.next();
}, "users");

// --- patients -------------------------------------------------------------------
onRecordCreateRequest((e) => {
  const isValidDate = (value) => {
    const date = new Date(value + "T00:00:00Z");
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const hn = e.record.getString("hn").trim().toUpperCase();
  const name = e.record.getString("name").trim();
  if (!hn || !name) throw new BadRequestError("กรุณาระบุ HN และชื่อผู้ป่วย");
  const dob = e.record.getString("dob");
  if (dob && !isValidDate(dob)) throw new BadRequestError("วันเกิดไม่ถูกต้อง");
  e.record.set("hn", hn);
  e.record.set("name", name);
  e.next();
}, "patients");
onRecordUpdateRequest((e) => {
  const isValidDate = (value) => {
    const date = new Date(value + "T00:00:00Z");
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const hn = e.record.getString("hn").trim().toUpperCase();
  const name = e.record.getString("name").trim();
  if (!hn || !name) throw new BadRequestError("กรุณาระบุ HN และชื่อผู้ป่วย");
  const dob = e.record.getString("dob");
  if (dob && !isValidDate(dob)) throw new BadRequestError("วันเกิดไม่ถูกต้อง");
  e.record.set("hn", hn);
  e.record.set("name", name);
  e.next();
}, "patients");

// --- implants master --------------------------------------------------------------
onRecordCreateRequest((e) => {
  const code = e.record.getString("product_code").trim().toUpperCase();
  if (!code) throw new BadRequestError("กรุณาระบุ Product Code");
  e.record.set("product_code", code);
  e.next();
}, "implants");
onRecordUpdateRequest((e) => {
  const code = e.record.getString("product_code").trim().toUpperCase();
  if (!code) throw new BadRequestError("กรุณาระบุ Product Code");
  e.record.set("product_code", code);
  e.next();
}, "implants");

// --- surgery cases: auto ID, forced draft status, change control ------------------
onRecordCreateRequest((e) => {
  const isValidDate = (value) => {
    const date = new Date(value + "T00:00:00Z");
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const generateNumber = (app, fieldName, kind) => {
    // goja's Intl support is limited, so derive Bangkok wall time from UTC+7.
    const yearMonth = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7).replace("-", "");
    const prefix = `${kind}-${yearMonth}-`;
    const existing = app.findRecordsByFilter("surgery_cases", `${fieldName} ~ "${prefix}%"`, "", 0, 0);
    let sequence = existing.length + 1;
    for (;;) {
      const candidate = prefix + String(sequence).padStart(4, "0");
      if (!existing.some((row) => row.getString(fieldName) === candidate)) return candidate;
      sequence++;
    }
  };
  const surgeryDate = e.record.getString("surgery_date");
  if (!isValidDate(surgeryDate)) throw new BadRequestError("วันผ่าตัดไม่ถูกต้อง");
  const surgeryTime = e.record.getString("surgery_time");
  if (surgeryTime && !/^\d{2}:\d{2}$/.test(surgeryTime)) throw new BadRequestError("เวลาผ่าตัดต้องอยู่ในรูปแบบ HH:MM");
  e.record.set("status", "draft");
  if (!e.record.getString("case_number")) e.record.set("case_number", generateNumber(e.app, "case_number", "EYE"));
  if (e.auth && e.auth.collection().name === "users" && !e.record.getString("created_by")) e.record.set("created_by", e.auth.id);
  e.next();
}, "surgery_cases");
onRecordUpdateRequest((e) => {
  const isValidDate = (value) => {
    const date = new Date(value + "T00:00:00Z");
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const lockedLabels = { patient: "ผู้ป่วย", eye: "ตาข้างที่ผ่าตัด", surgery_date: "วันผ่าตัด", surgeon: "ศัลยแพทย์", procedure: "หัตถการ" };
  const body = e.requestInfo().body || {};
  if (body.status !== undefined) {
    throw new BadRequestError("สถานะ Case เปลี่ยนได้ผ่านขั้นตอนยืนยันของระบบเท่านั้น");
  }
  const status = e.record.getString("status");
  if (status === "completed" || status === "cancelled") {
    throw new BadRequestError("Case ที่เสร็จสิ้นหรือถูกยกเลิกแล้วไม่สามารถแก้ไขได้");
  }
  if (status === "confirmed" || status === "or_verified") {
    for (const field of Object.keys(lockedLabels)) {
      if (body[field] !== undefined) {
        throw new BadRequestError(`หลังยืนยัน Case แล้วห้ามแก้ไข${lockedLabels[field]}โดยตรง กรุณายกเลิก Case แล้วสร้างใหม่`);
      }
    }
  }
  if (!isValidDate(e.record.getString("surgery_date"))) throw new BadRequestError("วันผ่าตัดไม่ถูกต้อง");
  e.next();
}, "surgery_cases");

// --- reservations: auto ID, implant snapshot, forced draft status ------------------
onRecordCreateRequest((e) => {
  const generateNumber = (app, fieldName, kind) => {
    // goja's Intl support is limited, so derive Bangkok wall time from UTC+7.
    const yearMonth = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7).replace("-", "");
    const prefix = `${kind}-${yearMonth}-`;
    const existing = app.findRecordsByFilter("reservations", `${fieldName} ~ "${prefix}%"`, "", 0, 0);
    let sequence = existing.length + 1;
    for (;;) {
      const candidate = prefix + String(sequence).padStart(4, "0");
      if (!existing.some((row) => row.getString(fieldName) === candidate)) return candidate;
      sequence++;
    }
  };
  let caseRecord;
  let implant;
  try {
    caseRecord = e.app.findRecordById("surgery_cases", e.record.getString("case"));
    implant = e.app.findRecordById("implants", e.record.getString("implant"));
  } catch {
    throw new BadRequestError("Case หรือ Implant ที่อ้างถึงไม่ถูกต้อง");
  }
  if (caseRecord.getString("status") === "cancelled" || caseRecord.getString("status") === "completed") {
    throw new BadRequestError("Case นี้ถูกยกเลิกหรือเสร็จสิ้นแล้ว ไม่สามารถสร้างการจองได้");
  }
  e.record.set("status", "draft");
  e.record.set("power_snapshot", implant.getString("power"));
  e.record.set("cylinder_snapshot", implant.getString("cylinder"));
  if (!e.record.getString("reservation_number")) e.record.set("reservation_number", generateNumber(e.app, "reservation_number", "RES"));
  if (e.auth && e.auth.collection().name === "users" && !e.record.getString("created_by")) e.record.set("created_by", e.auth.id);
  e.next();
}, "reservations");
onRecordUpdateRequest((e) => {
  const body = e.requestInfo().body || {};
  if (body.status !== undefined) {
    throw new BadRequestError("สถานะการจองเปลี่ยนได้ผ่านขั้นตอนของระบบเท่านั้น");
  }
  if (e.record.getString("status") !== "draft") throw new BadRequestError("แก้ไขการจองได้เฉพาะสถานะร่างเท่านั้น");
  e.next();
}, "reservations");

// --- stock lots: qty_reserved is owned by the reservation workflow -----------------
onRecordCreateRequest((e) => {
  const isValidDate = (value) => {
    const date = new Date(value + "T00:00:00Z");
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const body = e.requestInfo().body || {};
  if (body.qty_reserved !== undefined) {
    throw new BadRequestError("จำนวน Reserved เปลี่ยนได้ผ่านการยืนยัน/ยกเลิกการจองเท่านั้น");
  }
  const expiry = e.record.getString("expiry");
  if (expiry && !isValidDate(expiry)) throw new BadRequestError("วันหมดอายุไม่ถูกต้อง");
  if (e.record.get("qty_reserved") == null) e.record.set("qty_reserved", 0);
  e.next();
}, "stock_lots");
onRecordUpdateRequest((e) => {
  const isValidDate = (value) => {
    const date = new Date(value + "T00:00:00Z");
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const body = e.requestInfo().body || {};
  if (body.qty_reserved !== undefined) {
    throw new BadRequestError("จำนวน Reserved เปลี่ยนได้ผ่านการยืนยัน/ยกเลิกการจองเท่านั้น");
  }
  const expiry = e.record.getString("expiry");
  if (expiry && !isValidDate(expiry)) throw new BadRequestError("วันหมดอายุไม่ถูกต้อง");
  e.next();
}, "stock_lots");
