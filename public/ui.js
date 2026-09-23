// Shared DOM helpers, list controller and dialog builder.
// Every module renders with textContent only (no innerHTML) like the starter.
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  function badge(kind, text, title) {
    const element = node("span", `badge ${kind || ""}`, text);
    if (title) element.title = title;
    return element;
  }

  function action(label, callback, kind = "secondary") {
    const button = node("button", kind, label);
    button.type = "button";
    button.addEventListener("click", callback);
    return button;
  }

  function tell(text) { const notice = $("#notice"); if (notice) notice.textContent = text || ""; }

  async function submit(event, errorSelector, task) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    if (errorSelector) $(errorSelector).textContent = "";
    try { await task(); } catch (error) { if (errorSelector) $(errorSelector).textContent = error.message; }
    finally { button.disabled = false; }
  }

  function canWrite() { return Boolean(window.API?.user?.active && ["admin", "editor"].includes(API.user.role)); }
  function isAdmin() { return Boolean(window.API?.user?.active && API.user.role === "admin"); }

  function localDate(offsetDays = 0) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function daysUntil(dateString) {
    if (!dateString) return Infinity;
    const today = new Date(`${localDate()}T00:00:00`);
    const target = new Date(`${dateString}T00:00:00`);
    return Math.round((target - today) / 86400000);
  }

  function money(value) {
    const amount = Number(value || 0);
    return `${amount.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
  }

  function expiryState(dateString) {
    if (!dateString) return { cls: "info", label: "ไม่ระบุวันหมดอายุ" };
    const days = daysUntil(dateString);
    if (days < 0) return { cls: "problem", label: `หมดอายุ ${dateString}` };
    if (days <= 30) return { cls: "pending", label: `หมดอายุ ${dateString} (อีก ${days} วัน)` };
    return { cls: "ready", label: `หมดอายุ ${dateString}` };
  }

  const quoted = (value) => JSON.stringify(String(value));

  // Surgery readiness used by the dashboard and the schedule list.
  function readiness(caseRecord, reservations) {
    if (!caseRecord) return { cls: "pending", label: "-" };
    if (caseRecord.status === "cancelled") return { cls: "off", label: "ยกเลิกแล้ว" };
    if (caseRecord.status === "completed") return { cls: "done", label: "เสร็จสิ้น" };
    const active = (reservations || []).filter((row) => row.status !== "cancelled");
    if (!active.length) return { cls: "pending", label: "ยังไม่มีการจอง Implant" };
    const allConfirmed = active.every((row) => ["confirmed", "used"].includes(row.status));
    if (!allConfirmed) return { cls: "pending", label: "รอยืนยันการจอง" };
    const expiredLot = active.some((row) => row.expand?.confirmed_lot?.expiry && row.expand.confirmed_lot.expiry <= localDate());
    if (expiredLot) return { cls: "problem", label: "Implant ใน Lot ที่จองหมดอายุ" };
    const state = { cls: "ready", label: "พร้อมผ่าตัด" };
    const days = daysUntil(caseRecord.surgery_date);
    if (days < 0) { state.cls = "problem"; state.label = "เลยวันผ่าตัดแล้ว"; }
    return state;
  }

  async function fetchOptions(collection, labelFn, filter = "") {
    const data = await API.records(collection, { page: 1, perPage: 500, sort: "created", filter: filter || undefined });
    return data.items.map((item) => [item.id, labelFn(item)]);
  }

  function fillSelect(select, options, selectedValue) {
    select.replaceChildren();
    for (const [value, label] of options) select.append(new Option(label, value, false, value === selectedValue));
  }

  // Generic paginated list bound to a #view-<name> section (or a custom mount).
  function makeList(options) {
    const { view, mount, placeholder, filters = [], buildQuery, renderRow, emptyText = "ไม่พบข้อมูล", sort } = options;
    const section = mount || document.getElementById(`view-${view}`);
    section.replaceChildren();
    const form = node("form", "toolbar");
    form.setAttribute("role", "search");
    const searchWrap = node("label", "search-label");
    searchWrap.append(node("span", "sr-only", "ค้นหา"));
    const searchInput = node("input");
    searchInput.type = "search";
    searchInput.maxLength = 200;
    searchInput.placeholder = placeholder || "ค้นหา…";
    searchWrap.append(searchInput);
    form.append(searchWrap);
    const filterEls = {};
    for (const filter of filters) {
      const label = node("label", "filter-label");
      label.append(node("span", "sr-only", filter.label));
      const select = node("select");
      for (const [value, text] of filter.options) select.append(new Option(text, value));
      select.value = filter.value || filter.options[0]?.[0] || "";
      label.append(select);
      form.append(label);
      filterEls[filter.name] = select;
    }
    const submitButton = node("button", "secondary", "ค้นหา");
    submitButton.type = "submit";
    form.append(submitButton);

    const message = node("p", "list-message");
    message.setAttribute("role", "status");
    const records = node("div", "records");
    const pageInfo = node("span");
    const previous = node("button", "secondary", "ก่อนหน้า");
    previous.type = "button";
    const next = node("button", "secondary", "ถัดไป");
    next.type = "button";
    const buttons = node("div");
    buttons.append(previous, next);
    const footer = node("footer", "pagination");
    footer.append(pageInfo, buttons);
    const panel = node("section", "panel");
    panel.append(form, message, records, footer);
    section.append(panel);

    const state = { page: 1, total: 0, pages: 1, search: "", generation: 0, sort: sort || "-created,-id", extras: {} };
    for (const filter of filters) state.extras[filter.name] = filterEls[filter.name].value;

    const list = { state, section, records, message, filterEls, reload };

    async function reload() {
      const generation = ++state.generation;
      records.replaceChildren();
      message.textContent = "กำลังโหลดข้อมูล…";
      previous.disabled = next.disabled = true;
      try {
        await API.refresh();
        if (generation !== state.generation || !API.user) return;
        const query = buildQuery(state);
        const data = await API.records(query.collection, {
          page: state.page, perPage: window.APP_CONFIG.pageSize,
          sort: query.sort || state.sort, filter: query.filter, expand: query.expand,
        });
        if (generation !== state.generation) return;
        state.total = data.totalItems;
        state.pages = Math.max(1, data.totalPages);
        if (state.page > state.pages) { state.page = state.pages; await reload(); return; }
        message.textContent = data.items.length ? "" : state.search || Object.values(state.extras).some(Boolean) ? "ไม่พบข้อมูลที่ตรงกับการค้นหา" : emptyText;
        const fragment = document.createDocumentFragment();
        for (const record of data.items) fragment.append(renderRow(record, list));
        records.replaceChildren(fragment);
        pageInfo.textContent = `${state.total} รายการ · หน้า ${state.page} / ${state.pages}`;
        previous.disabled = state.page <= 1;
        next.disabled = state.page >= state.pages;
      } catch (error) {
        if (generation !== state.generation) return;
        records.replaceChildren();
        message.textContent = error.message;
        pageInfo.textContent = "";
      }
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      state.search = searchInput.value.trim();
      for (const [name, element] of Object.entries(filterEls)) state.extras[name] = element.value;
      state.page = 1;
      list.reload();
    });
    previous.addEventListener("click", () => { state.page--; list.reload(); });
    next.addEventListener("click", () => { state.page++; list.reload(); });
    return list;
  }

  // Generic create/edit dialog built from a field schema (used by masters).
  // fields: { name, label, type: text|number|date|select|checkbox|textarea,
  //           options, required, value, min, max, step, maxLength, placeholder, hint }
  function openFormDialog(options) {
    const { title, fields, submitLabel = "บันทึก", message, onSubmit, onCancel, wide } = options;
    const dialog = node("dialog", "form-dialog");
    if (wide) dialog.classList.add("wide");
    const form = node("form");
    const heading = node("div", "dialog-heading");
    const headingTitle = node("h2", "", title);
    const closeButton = node("button", "quiet", "✕");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "ปิด");
    closeButton.addEventListener("click", () => dialog.close());
    heading.append(headingTitle, closeButton);
    const fieldset = node("fieldset");
    if (message) fieldset.append(Object.assign(node("p", "muted"), { textContent: message }));
    const grid = node("div", "form-grid");
    const gridFields = fields.filter((field) => field.half);
    const fullFields = fields.filter((field) => !field.half);
    for (const field of fullFields) fieldset.append(buildField(field));
    if (gridFields.length) {
      for (const field of gridFields) grid.append(buildField(field));
      fieldset.append(grid);
    }
    const error = node("p", "error");
    error.setAttribute("role", "alert");
    const actions = node("div", "dialog-actions");
    const cancel = node("button", "secondary", "ปิด");
    cancel.type = "button";
    cancel.addEventListener("click", () => { dialog.close(); if (onCancel) onCancel(); });
    const save = node("button", "", submitLabel);
    save.type = "submit";
    actions.append(cancel, save);
    form.append(heading, fieldset, error, actions);
    dialog.append(form);
    document.body.append(dialog);

    function buildField(field) {
      const label = node("label");
      label.append(node("span", "", field.required ? `${field.label} *` : field.label));
      let input;
      if (field.type === "select") {
        input = node("select");
        if (!field.required) input.append(new Option(field.placeholder || "— ไม่ระบุ —", ""));
        for (const [value, text] of field.options || []) input.append(new Option(text, value));
        if (field.value !== undefined && field.value !== null) input.value = String(field.value);
      } else if (field.type === "checkbox") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(field.value);
        label.classList.add("checkbox");
      } else if (field.type === "textarea") {
        input = node("textarea");
        if (field.rows) input.rows = field.rows;
        if (field.maxLength) input.maxLength = field.maxLength;
        input.value = field.value ?? "";
      } else {
        input = document.createElement("input");
        input.type = field.type || "text";
        if (field.min !== undefined) input.min = field.min;
        if (field.max !== undefined) input.max = field.max;
        if (field.step !== undefined) input.step = field.step;
        if (field.maxLength) input.maxLength = field.maxLength;
        input.value = field.value ?? "";
      }
      input.name = field.name;
      if (field.required) input.required = true;
      if (field.placeholder) input.placeholder = field.placeholder;
      label.append(input);
      if (field.hint) label.append(Object.assign(node("small", "muted"), { textContent: field.hint }));
      return label;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      error.textContent = "";
      const values = {};
      for (const field of fields) {
        const element = form.elements[field.name];
        if (!element) continue;
        values[field.name] = field.type === "checkbox" ? element.checked : element.value;
      }
      try { await onSubmit(values); dialog.close(); }
      catch (err) { error.textContent = err.message; }
      finally { save.disabled = false; }
    });
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
    return dialog;
  }

  // Shared #delete-dialog with a per-call delete target and success callback.
  function confirmDelete(options) {
    $("#delete-name").textContent = options.name || "";
    $("#delete-note").textContent = options.note || "เมื่อลบแล้วจะไม่สามารถกู้คืนผ่านหน้าเว็บได้";
    $("#delete-error").textContent = "";
    $("#delete-form").onsubmit = (event) => submit(event, "#delete-error", async () => {
      await API.request(`/api/collections/${encodeURIComponent(options.collection)}/records/${encodeURIComponent(options.id)}`, { method: "DELETE" });
      $("#delete-dialog").close();
      tell("ลบรายการแล้ว");
      if (options.onDone) options.onDone();
    });
    $("#delete-dialog").showModal();
  }

  window.UI = {
    $, $$, node, badge, action, tell, submit, canWrite, isAdmin,
    localDate, daysUntil, money, expiryState, readiness, quoted,
    fetchOptions, fillSelect, makeList, openFormDialog, confirmDelete,
  };
})();
