// App shell: session handling, sidebar navigation and the management dashboard.
(() => {
  const { $, node, badge, quoted, localDate, daysUntil, readiness } = UI;

  const VIEW_META = {
    dashboard: { eyebrow: "ภาพรวมระบบ", title: "แดชบอร์ด", description: "สถานะ Case คลัง และสิ่งที่ต้องดำเนินการวันนี้" },
    cases: { eyebrow: "งานผ่าตัด", title: "ตารางผ่าตัด", description: "จัดการ Case และติดตามความพร้อมของ Implant ก่อนวันผ่าตัด" },
    reservations: { eyebrow: "งานผ่าตัด", title: "การจอง Implant", description: "ตรวจสอบ 2 คน ยืนยันการจอง และบันทึกการใช้งานจริง" },
    usage: { eyebrow: "งานผ่าตัด", title: "การใช้งาน & Traceability", description: "ประวัติการใช้ Implant และการตรวจสอบย้อนกลับถึงผู้ป่วย" },
    inventory: { eyebrow: "คลัง", title: "คลัง & Stock", description: "ติดตามจำนวนจริง ที่จอง คงเหลือ และวันหมดอายุของทุก Lot" },
    masters: { eyebrow: "การตั้งค่า", title: "ข้อมูลหลัก", description: "ผู้ป่วย Implant Master ร้านค้า แพทย์ และหัตถการ" },
    members: { eyebrow: "การตั้งค่า", title: "จัดการสมาชิก", description: "กำหนดสิทธิ์และจัดการสถานะบัญชีของทีม" },
  };
  let generation = 0;

  function closeDrawer() {
    $("#sidebar").classList.remove("open");
    $("#nav-backdrop").hidden = true;
  }

  function sessionUI() {
    const loggedIn = Boolean(API.user?.active);
    $("#login-panel").hidden = loggedIn;
    $("#workspace").hidden = !loggedIn;
    $("#account").hidden = !loggedIn;
    $("#menu-toggle").hidden = !loggedIn;
    $("#members-nav").hidden = !UI.isAdmin();
    $("#add-case-button").hidden = !(currentViewIs("cases") && UI.canWrite());
    $("#account-name").textContent = loggedIn ? `${API.user.name} · ${LABELS.roles[API.user.role] || ""}` : "";
    if (!loggedIn) {
      generation++;
      closeDrawer();
      document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
    }
  }

  const currentViewIs = (view) => {
    const selected = document.querySelector(".nav-item.selected");
    return selected?.dataset.view === view;
  };

  function setView(view) {
    if (view === "members" && !UI.isAdmin()) view = "dashboard";
    document.querySelectorAll(".view").forEach((section) => { section.hidden = section.id !== `view-${view}`; });
    document.querySelectorAll(".nav-item").forEach((button) => {
      const selected = button.dataset.view === view;
      button.className = `nav-item${selected ? " selected" : ""}`;
      button.setAttribute("aria-pressed", String(selected));
    });
    const meta = VIEW_META[view] || VIEW_META.dashboard;
    $("#page-eyebrow").textContent = meta.eyebrow;
    $("#page-title").textContent = meta.title;
    $("#page-description").textContent = meta.description;
    $("#add-case-button").hidden = !(view === "cases" && UI.canWrite());
    closeDrawer();
    generation++;
    sessionUI();
    if (window.Views[view]?.load) window.Views[view].load();
  }

  // --- dashboard -----------------------------------------------------------------------
  function kpiCard(value, label, kind) {
    const card = node("div", `kpi-card ${kind || ""}`);
    card.append(node("span", "kpi-num", String(value)), node("span", "kpi-label", label));
    return card;
  }

  async function loadDashboard() {
    const run = ++generation;
    const section = $("#view-dashboard");
    section.replaceChildren(node("p", "list-message", "กำลังโหลดข้อมูล…"));
    try {
      await API.refresh();
      if (run !== generation || !API.user) return;
      const today = localDate();
      const monthStart = `${today.slice(0, 7)}-01`;
      const [casesData, reservationsData, lotsData, usagesData] = await Promise.all([
        API.records("surgery_cases", { page: 1, perPage: 200, sort: "surgery_date,-created", filter: `surgery_date >= ${quoted(monthStart)}`, expand: "patient" }),
        API.records("reservations", { page: 1, perPage: 500, sort: "-created", expand: "confirmed_lot" }),
        API.records("stock_lots", { page: 1, perPage: 500, sort: "created", expand: "implant" }),
        API.records("implant_usages", { page: 1, perPage: 500, sort: "-used_at", filter: `used_at >= ${quoted(`${monthStart} 00:00:00`)}`, expand: "implant" }),
      ]);
      if (run !== generation) return;

      const reservations = reservationsData.items;
      const upcoming = casesData.items.filter((record) => record.surgery_date >= today && !["cancelled", "completed"].includes(record.status));
      const todayCases = upcoming.filter((record) => record.surgery_date === today);
      let ready = 0, pending = 0, problem = 0;
      const exceptions = [];
      for (const caseRecord of upcoming) {
        const state = readiness(caseRecord, reservations.filter((row) => row.case === caseRecord.id));
        const days = daysUntil(caseRecord.surgery_date);
        let cls = state.cls;
        if (cls !== "ready" && days <= 1) cls = "problem";
        if (cls === "ready") ready++;
        else if (cls === "problem") problem++;
        else pending++;
        if (cls !== "ready") {
          exceptions.push({
            severity: days <= 1 ? "problem" : "pending",
            text: `Case ${caseRecord.case_number} · ${caseRecord.expand?.patient?.name || "-"} · ผ่าตัด ${caseRecord.surgery_date} — ${state.label}${days === 0 ? " (ผ่าตัดวันนี้!)" : days === 1 ? " (ผ่าตัดพรุ่งนี้!)" : ""}`,
            view: "cases",
          });
        }
      }

      const perImplant = new Map();
      for (const lot of lotsData.items) {
        const entry = perImplant.get(lot.implant) || { available: 0, implant: lot.expand?.implant };
        entry.available += (lot.qty_physical || 0) - (lot.qty_reserved || 0);
        perImplant.set(lot.implant, entry);
      }
      for (const entry of perImplant.values()) {
        const minStock = Number(entry.implant?.min_stock || 0);
        const code = entry.implant?.product_code || "-";
        if (entry.available <= 0) exceptions.push({ severity: "problem", text: `${code} — 🔴 หมดสต๊อก (Out of Stock)`, view: "inventory" });
        else if (minStock > 0 && entry.available < minStock) exceptions.push({ severity: "pending", text: `${code} — 🟡 สต๊อกต่ำ เหลือ ${entry.available} ชิ้น (ต่ำกว่า Min ${minStock})`, view: "inventory" });
      }
      for (const lot of lotsData.items) {
        if (!lot.expiry) continue;
        const available = (lot.qty_physical || 0) - (lot.qty_reserved || 0);
        if (available <= 0) continue;
        const days = daysUntil(lot.expiry);
        const code = lot.expand?.implant?.product_code || "-";
        if (days < 0) exceptions.push({ severity: "problem", text: `Lot ${lot.lot || "-"} (${code}) — 🔴 หมดอายุแล้ว (${lot.expiry})`, view: "inventory" });
        else if (days <= 30) exceptions.push({ severity: "pending", text: `Lot ${lot.lot || "-"} (${code}) — 🟡 หมดอายุในอีก ${days} วัน (${lot.expiry})`, view: "inventory" });
      }

      const cost = usagesData.items.reduce((sum, usage) => sum + Number(usage.expand?.implant?.unit_price || 0), 0);
      const monthCases = casesData.items.filter((record) => record.status !== "cancelled").length;

      section.replaceChildren();
      const todayHeading = node("h2", "section-heading", "วันนี้");
      const todayGrid = node("div", "kpi-grid");
      todayGrid.append(
        kpiCard(todayCases.length, "ผ่าตัดวันนี้"),
        kpiCard(ready, "พร้อมผ่าตัด", "ready"),
        kpiCard(pending, "รอดำเนินการ", "pending"),
        kpiCard(problem, "มีปัญหา", problem ? "problem" : ""),
      );
      const monthHeading = node("h2", "section-heading", "เดือนนี้");
      const monthGrid = node("div", "kpi-grid");
      monthGrid.append(
        kpiCard(monthCases, "Case ทั้งเดือน"),
        kpiCard(usagesData.totalItems, "Implant ที่ใช้"),
        kpiCard(UI.money(cost), "มูลค่าการใช้ Implant"),
        kpiCard(reservations.filter((row) => ["confirmed", "used"].includes(row.status)).length, "การจองที่ยืนยันแล้ว", "info"),
      );
      const exceptionHeading = node("h2", "section-heading", "สิ่งที่ต้องดำเนินการ (Exception Center)");
      const exceptionCard = node("section", "panel exception-panel");
      if (!exceptions.length) {
        exceptionCard.append(node("p", "list-message", "✅ ไม่มีสิ่งที่ต้องดำเนินการด่วน — Case ทุกเคสพร้อม และ Stock ปกติ"));
      } else {
        for (const item of exceptions) {
          const row = node("button", `exception-item ${item.severity}`);
          row.type = "button";
          row.append(node("span", `dot ${item.severity}`), node("span", "exception-text", item.text));
          row.addEventListener("click", () => setView(item.view));
          exceptionCard.append(row);
        }
      }
      section.append(todayHeading, todayGrid, monthHeading, monthGrid, exceptionHeading, exceptionCard);
    } catch (error) {
      if (run !== generation) return;
      section.replaceChildren(node("p", "list-message", error.message));
    }
  }

  // --- wiring --------------------------------------------------------------------------
  $("#login-form").addEventListener("submit", (event) => {
    const form = event.currentTarget;
    UI.submit(event, "#login-error", async () => {
      try { await API.login(form.elements.identity.value.trim(), form.elements.password.value); }
      catch (error) { if (error.status === 400) throw new Error("อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกปิดใช้งาน"); throw error; }
      form.reset();
      setView("dashboard");
    });
  });

  $("#logout").addEventListener("click", () => { API.logout(); sessionUI(); $("#login-error").textContent = ""; });
  window.addEventListener("session-ended", () => { sessionUI(); });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  $("#menu-toggle").addEventListener("click", () => {
    if ($("#sidebar").classList.contains("open")) closeDrawer();
    else { $("#sidebar").classList.add("open"); $("#nav-backdrop").hidden = false; }
  });
  $("#nav-backdrop").addEventListener("click", closeDrawer);
  $("#add-case-button").addEventListener("click", () => window.Views.cases.openCreate());
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
  document.querySelectorAll("[data-app-name]").forEach((element) => { element.textContent = APP_CONFIG.appShort; });

  window.Views = window.Views || {};
  window.Views.dashboard = { load: loadDashboard };

  sessionUI();
  if (API.token) setView("dashboard");
})();
