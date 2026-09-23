// Implant usage history and two-way traceability (patient -> implant,
// lot/serial -> patients, i.e. recall support).
(() => {
  const { $, node, badge, action, quoted, localDate, expiryState, makeList } = UI;

  const section = document.getElementById("view-usage");
  let historyList;
  let traceMode = "patient";

  // --- layout: mode switch ----------------------------------------------------------
  const modeNav = node("nav", "sub-tabs");
  modeNav.setAttribute("aria-label", "โหมดการใช้งาน");
  const historyTab = node("button", "selected", "ประวัติการใช้ Implant");
  historyTab.type = "button";
  const traceTab = node("button", "quiet", "Traceability / Recall");
  traceTab.type = "button";
  modeNav.append(historyTab, traceTab);

  const historyPanel = node("div");
  const tracePanel = node("div");
  tracePanel.hidden = true;
  section.append(modeNav, historyPanel, tracePanel);

  historyTab.addEventListener("click", () => {
    historyTab.className = "selected"; traceTab.className = "quiet";
    historyPanel.hidden = false; tracePanel.hidden = true;
    if (API.user) historyList.reload();
  });
  traceTab.addEventListener("click", () => {
    traceTab.className = "selected"; historyTab.className = "quiet";
    historyPanel.hidden = true; tracePanel.hidden = false;
  });

  // --- usage history ------------------------------------------------------------------
  function renderRow(record) {
    const row = node("article", "record");
    const info = node("div", "record-main");
    const implant = record.expand?.implant;
    const patient = record.expand?.patient;
    const caseRecord = record.expand?.case;
    info.append(node("h2", "record-title", `${implant?.product_code || "-"} · ${implant?.brand || ""} ${implant?.model || ""} ${record.power || implant?.power || ""}`.trim()));
    const meta = node("div", "record-meta");
    meta.append(node("div", "", `${patient ? `${patient.name} (HN ${patient.hn})` : "-"} · Case ${caseRecord?.case_number || "-"} · ${caseRecord ? LABELS.eye[caseRecord.eye] || caseRecord.eye : "-"}`));
    meta.append(node("div", "", `ใช้เมื่อ ${record.used_at || "-"}${record.remark ? ` · หมายเหตุ: ${record.remark}` : ""}`));
    info.append(meta);
    const badges = node("div", "record-badges");
    if (record.lot) badges.append(badge("info", `Lot ${record.lot}`));
    if (record.serial) badges.append(badge("", `Serial ${record.serial}`));
    if (record.expiry) badges.append(badge(expiryState(record.expiry).cls, `หมดอายุ ${record.expiry}`));
    badges.append(badge("done", "ใช้แล้ว"));
    row.append(info, badges);
    return row;
  }

  historyList = makeList({
    mount: historyPanel,
    view: "usage-history",
    placeholder: "ค้นหา Lot / Serial / HN / ชื่อผู้ป่วย…",
    emptyText: "ยังไม่มีประวัติการใช้ Implant",
    buildQuery(state) {
      const filters = [];
      if (state.search) filters.push(`(lot ~ ${quoted(state.search)} || serial ~ ${quoted(state.search)} || patient.hn ~ ${quoted(state.search)} || patient.name ~ ${quoted(state.search)})`);
      return { collection: "implant_usages", filter: filters.join(" && "), expand: "case,patient,implant", sort: "-used_at" };
    },
    renderRow,
  });
  historyList.section.hidden = false;

  // --- traceability panel ------------------------------------------------------------
  const traceCard = node("section", "panel trace-panel");
  const traceForm = node("form", "toolbar");
  const modeLabel = node("label", "filter-label");
  modeLabel.append(node("span", "sr-only", "ทิศทางการค้นหา"));
  const modeSelect = node("select");
  modeSelect.append(new Option("ตามผู้ป่วย (HN / ชื่อ)", "patient"));
  modeSelect.append(new Option("ตาม Lot / Serial (Recall)", "lot"));
  modeLabel.append(modeSelect);
  const searchWrap = node("label", "search-label");
  searchWrap.append(node("span", "sr-only", "คำค้นหา"));
  const traceInput = node("input");
  traceInput.type = "search";
  traceInput.maxLength = 200;
  traceInput.placeholder = "กรอก HN ชื่อผู้ป่วย หรือ Lot/Serial แล้วกดค้นหา";
  searchWrap.append(traceInput);
  const traceButton = node("button", "secondary", "ค้นหา");
  traceButton.type = "submit";
  traceForm.append(modeLabel, searchWrap, traceButton);
  const traceMessage = node("p", "list-message");
  traceMessage.setAttribute("role", "status");
  const traceResults = node("div", "records trace-results");
  traceCard.append(traceForm, traceMessage, traceResults);
  tracePanel.append(traceCard);

  modeSelect.addEventListener("change", () => {
    traceMode = modeSelect.value;
    traceInput.placeholder = traceMode === "patient" ? "กรอก HN หรือชื่อผู้ป่วย" : "กรอกเลข Lot หรือ Serial ของ Implant";
  });

  traceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runTrace(traceInput.value.trim());
  });

  async function runTrace(query) {
    traceResults.replaceChildren();
    if (!query) { traceMessage.textContent = "กรุณากรอกคำค้นหา"; return; }
    traceMessage.textContent = "กำลังค้นหา…";
    try {
      await API.refresh();
      if (!API.user) return;
      if (traceMode === "patient") await traceByPatient(query);
      else await traceByLot(query);
    } catch (error) {
      traceMessage.textContent = error.message;
    }
  }

  function usageRow(record) {
    const implant = record.expand?.implant;
    const caseRecord = record.expand?.case;
    const row = node("div", "trace-usage");
    const main = node("div");
    main.append(node("div", "", `${implant?.product_code || "-"} · ${implant?.brand || ""} ${implant?.model || ""} · Power ${record.power || "-"}`));
    main.append(node("div", "muted", `Lot ${record.lot || "-"}${record.serial ? ` · Serial ${record.serial}` : ""} · Case ${caseRecord?.case_number || "-"} · ใช้เมื่อ ${record.used_at || "-"}${record.expiry ? ` · หมดอายุ ${record.expiry}` : ""}`));
    row.append(main);
    return row;
  }

  async function traceByPatient(query) {
    const patients = await API.records("patients", {
      page: 1, perPage: 10,
      filter: `hn ~ ${quoted(query)} || name ~ ${quoted(query)}`,
    });
    if (!patients.items.length) { traceMessage.textContent = "ไม่พบผู้ป่วยที่ตรงกับการค้นหา"; return; }
    traceMessage.textContent = `พบ ${patients.items.length} รายชื่อ (แสดงสูงสุด 10 ราย)`;
    const fragment = document.createDocumentFragment();
    for (const patient of patients.items) {
      const usages = await API.records("implant_usages", {
        page: 1, perPage: 100, filter: `patient = ${quoted(patient.id)}`, expand: "implant,case", sort: "-used_at",
      });
      const card = node("article", "record trace-card");
      const info = node("div", "record-main");
      info.append(node("h2", "record-title", `${patient.name} (HN ${patient.hn})`));
      info.append(node("div", "record-meta", `พบการใช้ Implant ${usages.totalItems} ครั้ง`));
      const badges = node("div", "record-badges");
      badges.append(badge(usages.totalItems ? "info" : "", usages.totalItems ? "มีประวัติการใช้" : "ยังไม่เคยใช้ Implant"));
      card.append(info, badges);
      for (const record of usages.items) card.append(usageRow(record));
      fragment.append(card);
    }
    traceResults.replaceChildren(fragment);
  }

  async function traceByLot(query) {
    const usages = await API.records("implant_usages", {
      page: 1, perPage: 200,
      filter: `lot = ${quoted(query)} || serial = ${quoted(query)}`,
      expand: "patient,implant,case", sort: "-used_at",
    });
    if (!usages.items.length) { traceMessage.textContent = "ไม่พบการใช้งานของ Lot/Serial นี้"; return; }
    const card = node("article", "record trace-card recall-card");
    const info = node("div", "record-main");
    info.append(node("h2", "record-title", `Recall: Lot/Serial "${query}"`));
    info.append(node("div", "record-meta", `พบผู้ป่วยที่ได้รับ Implant จาก Lot/Serial นี้ ${usages.totalItems} รายการ`));
    const badges = node("div", "record-badges");
    badges.append(badge("problem", "ผลกระทบต่อผู้ป่วย"));
    card.append(info, badges);
    const fragment = document.createDocumentFragment();
    fragment.append(card);
    for (const record of usages.items) {
      const patient = record.expand?.patient;
      const caseRecord = record.expand?.case;
      const row = node("div", "trace-usage");
      const main = node("div");
      main.append(node("div", "", `${patient ? `${patient.name} (HN ${patient.hn})` : "-"} · Case ${caseRecord?.case_number || "-"} · ${caseRecord ? LABELS.eye[caseRecord.eye] || caseRecord.eye : "-"} · ผ่าตัด ${caseRecord?.surgery_date || "-"}`));
      main.append(node("div", "muted", `${record.expand?.implant?.product_code || "-"} · Power ${record.power || "-"}${record.serial ? ` · Serial ${record.serial}` : ""} · ใช้เมื่อ ${record.used_at || "-"}`));
      row.append(main);
      fragment.append(row);
    }
    traceResults.replaceChildren(fragment);
    traceMessage.textContent = "แสดงผู้ป่วยทั้งหมดที่ได้รับ Implant จาก Lot/Serial นี้";
  }

  window.Views = window.Views || {};
  window.Views.usage = { load: () => { if (!historyPanel.hidden) historyList.reload(); } };
})();
