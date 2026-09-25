// Implant reservations: two-person verification, safety confirmation with
// lot selection, cancellation, and usage recording.
(() => {
  const { $, node, badge, action, tell, submit, canWrite, localDate, quoted, makeList, fetchOptions } = UI;

  let list;
  let current = null;       // reservation being verified/confirmed/used/cancelled
  let cancelTarget = null;  // { type: "reservation" | "case", id, label }
  let createForCase = null; // case record for the create dialog
  const EXPAND = "case,case.patient,case.surgeon,case.procedure,implant,first_checker,second_checker,confirmed_lot";

  const statusBadgeClass = { draft: "", first_checked: "pending", verified: "info", confirmed: "info", used: "done", cancelled: "off" };

  const implantLabel = (implant) => implant ? `${implant.product_code} · ${implant.brand || ""} ${implant.model || ""} ${implant.power || ""}`.trim() : "-";

  function summaryRows(reservation) {
    const caseRecord = reservation.expand?.case;
    const patient = caseRecord?.expand?.patient;
    return [
      ["เลขที่การจอง", reservation.reservation_number],
      ["Case", `${caseRecord?.case_number || "-"}`],
      ["ผู้ป่วย", patient ? `${patient.name} (HN ${patient.hn})` : "-"],
      ["ตาข้างที่ผ่าตัด", caseRecord ? LABELS.eye[caseRecord.eye] || caseRecord.eye : "-"],
      ["วันผ่าตัด", caseRecord?.surgery_date || "-"],
      ["หัตถการ", caseRecord?.expand?.procedure?.name || "-"],
      ["ศัลยแพทย์", caseRecord?.expand?.surgeon?.name || "-"],
      ["Implant", implantLabel(reservation.expand?.implant)],
      ["Power", reservation.power_snapshot || "-"],
      ["Cylinder", reservation.cylinder_snapshot || "-"],
      ["จำนวน", `${reservation.quantity} ชิ้น`],
    ];
  }

  function renderSummary(container, reservation) {
    container.replaceChildren();
    for (const [label, value] of summaryRows(reservation)) {
      const row = node("div", "summary-row");
      row.append(node("span", "summary-label", label), node("span", "summary-value", value));
      container.append(row);
    }
  }

  function renderRow(record) {
    const row = node("article", "record");
    const info = node("div", "record-main");
    const caseRecord = record.expand?.case;
    const patient = caseRecord?.expand?.patient;
    info.append(node("h2", "record-title", `${record.reservation_number} · ${implantLabel(record.expand?.implant)}`));
    const meta = node("div", "record-meta");
    meta.append(node("div", "", `Case ${caseRecord?.case_number || "-"} · ${patient ? `${patient.name} (HN ${patient.hn})` : "-"} · ${caseRecord ? LABELS.eye[caseRecord.eye] || caseRecord.eye : "-"}`));
    meta.append(node("div", "", `ผ่าตัด ${caseRecord?.surgery_date || "-"} · จำนวน ${record.quantity} ชิ้น`));
    const first = record.expand?.first_checker?.name;
    const second = record.expand?.second_checker?.name;
    meta.append(node("div", "", `ตรวจสอบ 1: ${first || "-"}${record.first_check_at ? ` (${record.first_check_at})` : ""} · ตรวจสอบ 2: ${second || "-"}${record.second_check_at ? ` (${record.second_check_at})` : ""}`));
    const lot = record.expand?.confirmed_lot;
    if (record.status === "confirmed" && lot) {
      meta.append(node("div", "", `Reserved Lot ${lot.lot || "-"} · หมดอายุ ${lot.expiry || "-"} · ที่ตั้ง ${lot.location || "-"}`));
    }
    if (record.status === "cancelled" && record.cancel_reason) {
      meta.append(node("div", "", `เหตุผลการยกเลิก: ${record.cancel_reason}`));
    }
    info.append(meta);

    const badges = node("div", "record-badges");
    badges.append(badge(statusBadgeClass[record.status] || "", LABELS.resStatus[record.status] || record.status));

    const actions = node("div", "record-actions");
    if (canWrite()) {
      if (record.status === "draft") actions.append(action("ตรวจสอบครั้งที่ 1", () => openVerify(record, "first")));
      if (record.status === "first_checked") actions.append(action("ตรวจสอบครั้งที่ 2", () => openVerify(record, "second")));
      if (record.status === "verified") actions.append(action("ยืนยันการจอง", () => openConfirm(record)));
      if (record.status === "confirmed") actions.append(action("บันทึกใช้ Implant", () => openUse(record)));
      if (["draft", "first_checked", "verified", "confirmed"].includes(record.status)) {
        actions.append(action("ยกเลิกการจอง", () => openCancelReservation(record), "quiet"));
      }
      if (record.status === "draft") {
        actions.append(action("ลบ", () => UI.confirmDelete({
          collection: "reservations", id: record.id, name: record.reservation_number,
          onDone: () => list.reload(),
        }), "quiet"));
      }
    }
    row.append(info, badges, actions);
    return row;
  }

  list = makeList({
    view: "reservations",
    placeholder: "ค้นหาเลขที่การจอง / เลข Case / HN / Product Code…",
    emptyText: "ยังไม่มีการจอง Implant",
    filters: [
      { name: "status", label: "สถานะ", options: [["", "ทุกสถานะ"], ...Object.entries(LABELS.resStatus)] },
    ],
    buildQuery(state) {
      const filters = [];
      if (state.search) filters.push(`(reservation_number ~ ${quoted(state.search)} || case.case_number ~ ${quoted(state.search)} || case.patient.hn ~ ${quoted(state.search)} || case.patient.name ~ ${quoted(state.search)} || implant.product_code ~ ${quoted(state.search)})`);
      if (state.extras.status) filters.push(`status = ${quoted(state.extras.status)}`);
      return { collection: "reservations", filter: filters.join(" && "), expand: EXPAND };
    },
    renderRow,
  });

  // --- create reservation ------------------------------------------------------
  async function openCreate(caseRecord) {
    createForCase = caseRecord;
    const form = $("#reservation-form");
    form.reset();
    const patient = caseRecord.expand?.patient;
    $("#reservation-case-info").textContent = `Case ${caseRecord.case_number} · ${patient ? `${patient.name} (HN ${patient.hn})` : "-"} · ${LABELS.eye[caseRecord.eye] || caseRecord.eye} · ผ่าตัด ${caseRecord.surgery_date}`;
    const options = await fetchOptions("implants", (item) => implantLabel(item)).catch(() => []);
    UI.fillSelect(form.elements.implant, [["", "— เลือก Implant —"], ...options], "");
    $("#reservation-stock-info").hidden = true;
    $("#reservation-fields").disabled = false;
    $("#save-reservation").hidden = false;
    $("#reservation-error").textContent = "";
    $("#reservation-dialog").showModal();
  }

  $("#reservation-implant").addEventListener("change", async (event) => {
    const box = $("#reservation-stock-info");
    const implantId = event.target.value;
    if (!implantId) { box.hidden = true; return; }
    try {
      const data = await API.records("stock_lots", { page: 1, perPage: 200, filter: `implant = ${quoted(implantId)}` });
      const today = localDate();
      let physical = 0, reserved = 0;
      const lines = [];
      for (const lot of data.items) {
        physical += lot.qty_physical || 0;
        reserved += lot.qty_reserved || 0;
        const available = (lot.qty_physical || 0) - (lot.qty_reserved || 0);
        const expired = lot.expiry && lot.expiry <= today;
        lines.push(`Lot ${lot.lot || "-"} · หมดอายุ ${lot.expiry || "-"} · คงเหลือ ${available}${expired ? " (หมดอายุแล้ว)" : ""}`);
      }
      box.replaceChildren();
      box.append(node("strong", "", `Stock จริง ${physical} · จองอยู่ ${reserved} · คงเหลือ ${physical - reserved} ชิ้น`));
      if (lines.length) { const listNode = node("div", "muted"); lines.slice(0, 6).forEach((line) => listNode.append(node("div", "", line))); box.append(listNode); }
      else box.append(node("div", "muted", "ยังไม่มี Stock ของ Implant นี้ในคลัง — ต้องรับเข้าก่อนยืนยันการจอง"));
      box.hidden = false;
    } catch { box.hidden = true; }
  });

  $("#reservation-form").addEventListener("submit", (event) => {
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    submit(event, "#reservation-error", async () => {
      if (!createForCase || !body.implant) throw new Error("กรุณาเลือก Implant ที่จะจอง");
      await API.request("/api/collections/reservations/records", { method: "POST", body: { case: createForCase.id, implant: body.implant, quantity: Number(body.quantity) || 1 } });
      $("#reservation-dialog").close();
      tell("สร้างการจองแล้ว กรุณาดำเนินการตรวจสอบ 2 คน");
      list.reload();
    });
  });

  // --- verify -------------------------------------------------------------------
  let verifyStage = "first";
  function openVerify(reservation, stage) {
    current = reservation;
    verifyStage = stage;
    $("#verify-stage").textContent = stage === "first" ? "FIRST CHECK — การตรวจสอบครั้งที่ 1" : "SECOND CHECK — การตรวจสอบครั้งที่ 2 (ต้องเป็นคนละคนกับผู้ตรวจสอบครั้งแรก)";
    renderSummary($("#verify-summary"), reservation);
    $("#verify-error").textContent = "";
    $("#verify-dialog").showModal();
  }

  $("#verify-form").addEventListener("submit", (event) => {
    submit(event, "#verify-error", async () => {
      await API.workflow("verify", { reservation: current.id, stage: verifyStage });
      $("#verify-dialog").close();
      tell(verifyStage === "first" ? "บันทึกการตรวจสอบครั้งที่ 1 แล้ว" : "ตรวจสอบครบ 2 คนแล้ว สามารถยืนยันการจองได้");
      list.reload();
    });
  });

  // --- confirm with safety checklist ---------------------------------------------
  async function openConfirm(reservation) {
    current = reservation;
    renderSummary($("#confirm-summary"), reservation);
    const lotSelect = $("#confirm-lot");
    lotSelect.replaceChildren(new Option("ให้ระบบเลือกอัตโนมัติ (Lot ที่ใกล้หมดอายุที่สุดที่ใช้ได้)", ""));
    const hint = $("#confirm-lot-hint");
    const code = reservation.expand?.implant?.product_code || "-";
    try {
      const data = await API.records("stock_lots", { page: 1, perPage: 200, filter: `implant = ${quoted(reservation.implant)}` });
      const today = localDate();
      const usable = data.items
        .filter((lot) => (lot.qty_physical - lot.qty_reserved) >= reservation.quantity && (!lot.expiry || lot.expiry > today))
        .sort((a, b) => (a.expiry || "9999-12-31").localeCompare(b.expiry || "9999-12-31"));
      for (const lot of usable) {
        lotSelect.append(new Option(`Lot ${lot.lot || "-"} · หมดอายุ ${lot.expiry || "-"} · เหลือ ${lot.qty_physical - lot.qty_reserved} ชิ้น`, lot.id));
      }
      hint.replaceChildren();
      if (!usable.length) {
        // Show exactly why each lot is unusable so the nurse can act on it.
        if (!data.items.length) {
          hint.append(node("div", "", `ยังไม่มี Lot ของ ${code} ในคลัง — รับเข้าคลังก่อนยืนยัน หรือตรวจว่าการจองเลือก Implant ตัวเดียวกับที่รับเข้าจริง`));
        } else {
          hint.append(node("div", "", `Lot ของ ${code} ที่มีในคลังใช้ไม่ได้ทั้งหมด (ต้องการ ${reservation.quantity} ชิ้น):`));
          for (const lot of data.items) {
            const available = (lot.qty_physical || 0) - (lot.qty_reserved || 0);
            const reason = lot.expiry && lot.expiry < today ? `🔴 หมดอายุแล้ว (${lot.expiry})`
              : lot.expiry && lot.expiry === today ? `🔴 หมดอายุภายในวันนี้ (${lot.expiry})`
              : `🟡 ถูกจองจนคงเหลือ ${available} ชิ้น ไม่พอ`;
            hint.append(node("div", "", `Lot ${lot.lot || "-"} · จริง ${lot.qty_physical} / จอง ${lot.qty_reserved} · ${reason}`));
          }
        }
        $("#confirm-error").textContent = "ไม่มี Stock ที่ใช้ได้ — ดูเหตุผลข้างต้น ต้องมี Lot พร้อมก่อนจึงยืนยันได้";
      } else {
        hint.append(node("div", "", 'เลือก "ให้ระบบเลือกอัตโนมัติ" เพื่อจองจาก Lot ที่ใกล้หมดอายุที่สุดที่ยังใช้ได้'));
        $("#confirm-error").textContent = "";
      }
    } catch (error) {
      hint.replaceChildren();
      $("#confirm-error").textContent = error.message;
    }
    document.querySelectorAll(".safety-check").forEach((box) => { box.checked = false; });
    $("#confirm-dialog").showModal();
  }

  $("#confirm-form").addEventListener("submit", (event) => {
    submit(event, "#confirm-error", async () => {
      const unchecked = document.querySelectorAll(".safety-check:not(:checked)").length;
      if (unchecked > 0) throw new Error(`ต้องติ๊กยืนยันครบทุกข้อใน Safety Check (ยังขาดอีก ${unchecked} ข้อ)`);
      const body = { reservation: current.id };
      if ($("#confirm-lot").value) body.lot = $("#confirm-lot").value;
      await API.workflow("confirm", body);
      $("#confirm-dialog").close();
      tell("ยืนยันการจองและ Reserve Stock แล้ว");
      list.reload();
    });
  });

  // --- record usage ------------------------------------------------------------------
  function openUse(reservation) {
    current = reservation;
    renderSummary($("#use-summary"), reservation);
    const lot = reservation.expand?.confirmed_lot;
    const form = $("#use-form");
    form.reset();
    form.elements.power.value = reservation.power_snapshot || "";
    form.elements.serial.value = lot?.serial || "";
    if (lot) {
      const lotLine = node("div", "summary-row problem-text");
      lotLine.append(node("span", "summary-label", "Lot ที่ Reserve ไว้"), node("span", "summary-value", `${lot.lot || "-"} · หมดอายุ ${lot.expiry || "-"} · Serial ${lot.serial || "-"}`));
      $("#use-summary").append(lotLine);
    }
    $("#use-fields").disabled = !canWrite();
    $("#use-submit").hidden = !canWrite();
    $("#use-error").textContent = "";
    $("#use-dialog").showModal();
  }

  $("#use-form").addEventListener("submit", (event) => {
    const body = Object.fromEntries(new FormData(event.currentTarget));
    submit(event, "#use-error", async () => {
      await API.workflow("use", { reservation: current.id, power: body.power || "", serial: body.serial || "", remark: body.remark || "" });
      $("#use-dialog").close();
      tell("บันทึกการใช้ Implant และตัด Stock แล้ว");
      list.reload();
    });
  });

  // --- cancellations -------------------------------------------------------------------
  function openCancelReservation(reservation) {
    cancelTarget = { type: "reservation", id: reservation.id, label: reservation.reservation_number };
    $("#cancel-dialog-title").textContent = "ยกเลิกการจอง";
    $("#cancel-message").textContent = `ยกเลิกการจอง ${reservation.reservation_number} ใช่หรือไม่?`;
    $("#cancel-error").textContent = "";
    $("#cancel-form").reset();
    $("#cancel-dialog").showModal();
  }

  function openCancelCase(caseRecord) {
    cancelTarget = { type: "case", id: caseRecord.id, label: caseRecord.case_number };
    $("#cancel-dialog-title").textContent = "ยกเลิก Case";
    $("#cancel-message").textContent = `ยกเลิก Case ${caseRecord.case_number} ใช่หรือไม่? การจอง Implant ทั้งหมดของ Case นี้จะถูกยกเลิกและคืน Stock ที่ Reserve ไว้`;
    $("#cancel-error").textContent = "";
    $("#cancel-form").reset();
    $("#cancel-dialog").showModal();
  }

  $("#cancel-form").addEventListener("submit", (event) => {
    const form = event.currentTarget;
    const reason = form.elements.reason.value.trim();
    submit(event, "#cancel-error", async () => {
      if (!reason) throw new Error("กรุณาระบุเหตุผลในการยกเลิก");
      if (cancelTarget.type === "case") await API.workflow("cancel-case", { case: cancelTarget.id, reason });
      else await API.workflow("cancel-reservation", { reservation: cancelTarget.id, reason });
      $("#cancel-dialog").close();
      tell("ยกเลิกเรียบร้อยแล้ว และคืน Stock ที่ Reserve ไว้ (ถ้ามี)");
      list.reload();
      if (cancelTarget.type === "case" && window.Views.cases) window.Views.cases.load();
    });
  });

  window.Views = window.Views || {};
  window.Views.reservations = {
    load: () => list.reload(),
    openCreate,
    openCancelCase,
  };
})();
