// Surgery schedule: list, create/edit cases and drive the per-status actions.
(() => {
  const { $, node, badge, action, tell, submit, canWrite, isAdmin, localDate, quoted, readiness, daysUntil, makeList, fetchOptions } = UI;

  let list;
  let editing = null;
  let reservationsCache = [];
  let optionCache = { patients: null, doctors: null, procedures: null };

  async function prefetchReservations() {
    try {
      const data = await API.records("reservations", { page: 1, perPage: 500, sort: "-created", expand: "confirmed_lot" });
      reservationsCache = data.items;
    } catch { reservationsCache = []; }
  }

  function statusBadgeClass(status) {
    return { draft: "", confirmed: "info", or_verified: "info", completed: "done", cancelled: "off" }[status] || "";
  }

  function renderRow(record) {
    const row = node("article", "record");
    const info = node("div", "record-main");
    const patient = record.expand?.patient;
    info.append(node("h2", "record-title", `${record.case_number} · ${patient ? patient.name : "ไม่พบผู้ป่วย"}`));
    const meta = node("div", "record-meta");
    meta.append(node("div", "", `HN ${patient?.hn || "-"} · ${LABELS.eye[record.eye] || record.eye} · ${record.priority === "urgent" ? "🔴 ด่วน" : "ปกติ"}`));
    meta.append(node("div", "", `วันผ่าตัด ${record.surgery_date}${record.surgery_time ? ` เวลา ${record.surgery_time}` : ""}${record.or_room ? ` · ห้อง ${record.or_room}` : ""}`));
    meta.append(node("div", "", `ศัลยแพทย์ ${record.expand?.surgeon?.name || "-"} · หัตถการ ${record.expand?.procedure?.name || "-"}`));
    if (record.diagnosis) meta.append(node("div", "", `DX: ${record.diagnosis}`));
    info.append(meta);

    const badges = node("div", "record-badges");
    badges.append(badge(statusBadgeClass(record.status), LABELS.caseStatus[record.status] || record.status));
    const caseReservations = reservationsCache.filter((item) => item.case === record.id);
    const state = readiness(record, caseReservations);
    let readinessLabel = state.label;
    let readinessClass = state.cls;
    if (["draft", "confirmed", "or_verified"].includes(record.status)) {
      const days = daysUntil(record.surgery_date);
      if (days <= 1 && readinessClass !== "ready") {
        readinessClass = "problem";
        readinessLabel = `${state.label} — ผ่าตัด${days === 0 ? "วันนี้" : "พรุ่งนี้"}!`;
      }
    }
    badges.append(badge(readinessClass, readinessLabel));

    const actions = node("div", "record-actions");
    actions.append(action(canWrite() ? "แก้ไข / ดู" : "ดูรายละเอียด", () => openCaseDialog(record)));
    if (canWrite()) {
      if (["draft", "confirmed", "or_verified"].includes(record.status)) {
        actions.append(action("จอง Implant", () => window.Views.reservations.openCreate(record)));
      }
      if (record.status === "confirmed") {
        actions.append(action("บันทึก OR Verified", async () => {
          try { await API.workflow("or-verify", { case: record.id }); tell("บันทึก OR Verified แล้ว"); list.reload(); }
          catch (error) { tell(error.message); }
        }));
      }
      if (["draft", "confirmed", "or_verified"].includes(record.status)) {
        actions.append(action("ยกเลิก Case", () => window.Views.reservations.openCancelCase(record), "quiet"));
      }
      if (isAdmin() && record.status === "draft") {
        actions.append(action("ลบ", () => UI.confirmDelete({
          collection: "surgery_cases", id: record.id, name: record.case_number,
          note: "Case ที่มีการจองหรือการใช้งานจะลบไม่ได้", onDone: () => list.reload(),
        }), "quiet"));
      }
    }
    row.append(info, badges, actions);
    return row;
  }

  list = makeList({
    view: "cases",
    placeholder: "ค้นหาเลข Case / HN / ชื่อผู้ป่วย…",
    emptyText: "ยังไม่มี Case ผ่าตัด เริ่มเพิ่ม Case แรกได้เลย",
    sort: "surgery_date,-created",
    filters: [
      { name: "scope", label: "ช่วงเวลา", options: [["upcoming", "กำลังจะมาถึง"], ["all", "ทุกช่วงเวลา"], ["past", "ที่ผ่านมาแล้ว"]] },
      { name: "status", label: "สถานะ", options: [["", "ทุกสถานะ"], ...Object.entries(LABELS.caseStatus)] },
      { name: "eye", label: "ตา", options: [["", "ทุกตา"], ...Object.entries(LABELS.eye)] },
    ],
    buildQuery(state) {
      const filters = [];
      if (state.search) filters.push(`(case_number ~ ${quoted(state.search)} || patient.hn ~ ${quoted(state.search)} || patient.name ~ ${quoted(state.search)})`);
      if (state.extras.scope === "upcoming") filters.push(`surgery_date >= ${quoted(localDate())}`);
      if (state.extras.scope === "past") filters.push(`surgery_date < ${quoted(localDate())}`);
      if (state.extras.status) filters.push(`status = ${quoted(state.extras.status)}`);
      if (state.extras.eye) filters.push(`eye = ${quoted(state.extras.eye)}`);
      return { collection: "surgery_cases", filter: filters.join(" && "), expand: "patient,surgeon,procedure" };
    },
    renderRow,
  });

  const baseReload = list.reload;
  list.reload = async () => { await prefetchReservations(); await baseReload(); };

  async function ensureOptions(kind) {
    if (optionCache[kind]) return optionCache[kind];
    const labels = {
      patients: (item) => `${item.hn} · ${item.name}`,
      doctors: (item) => item.name,
      procedures: (item) => item.name,
    };
    optionCache[kind] = await fetchOptions(kind, labels[kind]);
    return optionCache[kind];
  }

  async function openCaseDialog(record = null) {
    editing = record;
    const form = $("#case-form");
    form.reset();
    const [patients, doctors, procedures] = await Promise.all([
      ensureOptions("patients"), ensureOptions("doctors"), ensureOptions("procedures"),
    ]);
    UI.fillSelect(form.elements.patient, [["", "— เลือกผู้ป่วย —"], ...patients], record?.patient || "");
    UI.fillSelect(form.elements.surgeon, [["", "— ไม่ระบุ —"], ...doctors], record?.surgeon || "");
    UI.fillSelect(form.elements.procedure, [["", "— ไม่ระบุ —"], ...procedures], record?.procedure || "");
    const values = record || { surgery_date: localDate(7), surgery_time: "", eye: "", priority: "normal", or_room: "", diagnosis: "", notes: "" };
    for (const key of ["surgery_date", "surgery_time", "eye", "priority", "or_room", "diagnosis", "notes"]) form.elements[key].value = values[key] || "";

    const locked = Boolean(record && ["confirmed", "or_verified"].includes(record.status));
    const readonly = !canWrite() || Boolean(record && ["completed", "cancelled"].includes(record.status));
    form.querySelectorAll("input, select, textarea").forEach((element) => { element.disabled = readonly; });
    if (locked) form.querySelectorAll("[data-locked]").forEach((element) => { element.disabled = true; });
    form.elements.patient.disabled = locked || readonly;
    $("#case-new-patient").hidden = !canWrite() || locked || readonly;
    $("#case-lock-note").hidden = !locked;
    $("#save-case").hidden = readonly;
    $("#case-fields").disabled = readonly;
    $("#case-dialog-title").textContent = readonly && !canWrite() ? "รายละเอียด Case" : record ? (locked ? "รายละเอียด Case (ยืนยันแล้ว)" : "แก้ไข Case") : "เพิ่ม Case ผ่าตัด";
    $("#case-error").textContent = "";
    $("#case-dialog").showModal();
  }

  $("#case-new-patient").addEventListener("click", async () => {
    optionCache.patients = null;
    window.Views.masters.openPatientDialog(async (patient) => {
      const options = await ensureOptions("patients");
      const form = $("#case-form");
      UI.fillSelect(form.elements.patient, [["", "— เลือกผู้ป่วย —"], ...options], patient.id);
    });
  });

  $("#case-form").addEventListener("submit", (event) => {
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    submit(event, "#case-error", async () => {
      const date = new Date(`${body.surgery_date}T00:00:00Z`);
      if (!body.patient || !body.eye || !body.surgery_date || isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== body.surgery_date) {
        throw new Error("กรุณาระบุผู้ป่วย ตาข้างที่ผ่าตัด และวันผ่าตัดที่ถูกต้อง");
      }
      if (body.surgery_time) body.surgery_time = body.surgery_time.slice(0, 5);
      await API.request(`/api/collections/surgery_cases/records${editing ? `/${editing.id}` : ""}`, { method: editing ? "PATCH" : "POST", body });
      $("#case-dialog").close();
      tell("บันทึก Case แล้ว");
      list.reload();
    });
  });

  window.Views = window.Views || {};
  window.Views.cases = {
    load: () => list.reload(),
    openCreate: () => openCaseDialog(),
    invalidateOptions: () => { optionCache = { patients: null, doctors: null, procedures: null }; },
  };
})();
