(() => {
  const $ = (selector) => document.querySelector(selector);
  const roles = { viewer: "ผู้ชม", editor: "ผู้แก้ไข", admin: "ผู้ดูแล" };
  const statuses = { todo: "รอดำเนินการ", doing: "กำลังดำเนินการ", done: "เสร็จแล้ว" };
  const state = { view: "items", page: 1, total: 0, pages: 1, records: [], editing: null, deleting: null, search: "", status: "", generation: 0 };
  const canWrite = () => API.user?.active && ["admin", "editor"].includes(API.user.role);
  const endpoint = () => `/api/collections/${state.view === "users" ? "users" : encodeURIComponent(APP_CONFIG.collection)}/records`;
  const quoted = (value) => JSON.stringify(String(value));
  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }
  function tell(text) { $("#notice").textContent = text; }
  function sessionUI() {
    const loggedIn = Boolean(API.user?.active);
    $("#login-panel").hidden = loggedIn;
    $("#workspace").hidden = !loggedIn;
    $("#account").hidden = !loggedIn;
    $("#users-tab").hidden = API.user?.role !== "admin";
    $("#add-case-button").hidden = !canWrite() || state.view !== "items";
    $("#account-name").textContent = loggedIn ? `${API.user.name} · ${roles[API.user.role] || ""}` : "";
    if (!loggedIn) {
      state.generation++;
      state.records = [];
      $("#records").replaceChildren();
      document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
    }
  }
  function setView(view) {
    state.view = view; state.page = 1; state.search = ""; state.status = "";
    $("#search").value = ""; $("#status-filter").value = "";
    $("#status-filter-label").hidden = view === "users";
    $("#search").placeholder = view === "users" ? "ค้นหาชื่อสมาชิก…" : "ค้นหาชื่อหรือรายละเอียด…";
    $("#page-title").textContent = view === "users" ? "จัดการสมาชิก" : "รายการงาน";
    $("#page-description").textContent = view === "users" ? "กำหนดสิทธิ์และจัดการสถานะบัญชีของทีม" : "เก็บรายละเอียด ติดตามสถานะ และจัดการงานในที่เดียว";
    ["items", "users"].forEach((name) => { $(`#${name}-tab`).className = name === view ? "selected" : "quiet"; $(`#${name}-tab`).setAttribute("aria-pressed", String(name === view)); });
    tell(""); sessionUI();
  }
  async function load() {
    const generation = ++state.generation;
    $("#records").replaceChildren();
    $("#list-message").textContent = "กำลังโหลดข้อมูล…";
    $("#previous").disabled = $("#next").disabled = true;
    try {
      await API.refresh();
      if (generation !== state.generation || !API.user) return;
      if (state.view === "users" && API.user.role !== "admin") { setView("items"); await load(); return; }
      sessionUI();
      const filters = [];
      if (state.search) filters.push(state.view === "users" ? `name ~ ${quoted(state.search)}` : `(title ~ ${quoted(state.search)} || description ~ ${quoted(state.search)})`);
      if (state.status && state.view === "items") filters.push(`status = ${quoted(state.status)}`);
      const params = new URLSearchParams({ page: state.page, perPage: APP_CONFIG.pageSize, sort: "-created,-id" });
      if (filters.length) params.set("filter", filters.join(" && "));
      const data = await API.request(`${endpoint()}?${params}`);
      if (generation !== state.generation) return;
      state.records = data.items; state.total = data.totalItems; state.pages = Math.max(1, data.totalPages);
      if (state.page > state.pages) { state.page = state.pages; await load(); return; }
      render();
    } catch (error) {
      if (generation !== state.generation) return;
      state.records = [];
      $("#list-message").textContent = error.message;
      $("#page-info").textContent = "";
      sessionUI();
    }
  }
  function action(label, callback, danger = false) {
    const button = node("button", danger ? "quiet" : "secondary", label);
    button.type = "button"; button.addEventListener("click", callback); return button;
  }
  function render() {
    $("#list-message").textContent = state.records.length ? "" : state.search || state.status ? "ไม่พบข้อมูลที่ตรงกับการค้นหา" : state.view === "items" ? "ยังไม่มีรายการ เริ่มเพิ่มรายการแรกได้เลย" : "ไม่พบสมาชิก";
    const fragment = document.createDocumentFragment();
    state.records.forEach((record) => {
      const row = node("article", "record");
      const info = node("div");
      info.append(node("h2", "record-title", state.view === "users" ? record.name : record.title));
      info.append(node("div", "record-meta", state.view === "users" ? `ID: ${record.id}${record.id === API.user.id ? " · บัญชีของคุณ" : ""}` : `กำหนด ${record.due_date} · จำนวน ${record.quantity}`));
      const badge = node("span", `badge ${state.view === "users" ? record.active ? record.role : "off" : record.status}`, state.view === "users" ? `${roles[record.role]}${record.active ? "" : " · ปิดใช้งาน"}` : statuses[record.status]);
      const actions = node("div", "record-actions");
      if (state.view === "users") {
        if (record.id !== API.user.id) actions.append(action("แก้ไขสมาชิก", () => openUser(record)));
      } else {
        actions.append(action(canWrite() ? "แก้ไข / ดู" : "ดูรายละเอียด", () => openItem(record)));
        if (canWrite()) actions.append(action("ลบ", () => { state.deleting = record; $("#delete-name").textContent = record.title; $("#delete-error").textContent = ""; $("#delete-dialog").showModal(); }, true));
      }
      row.append(info, badge, actions); fragment.append(row);
    });
    $("#records").replaceChildren(fragment);
    $("#page-info").textContent = `${state.total} รายการ · หน้า ${state.page} / ${state.pages}`;
    $("#previous").disabled = state.page <= 1; $("#next").disabled = state.page >= state.pages;
  }
  function openItem(record = null) {
    state.editing = record;
    const form = $("#item-form"); form.reset();
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const values = record || { title: "", quantity: 1, due_date: localDate, status: "todo", description: "" };
    ["title", "quantity", "due_date", "status", "description"].forEach((key) => { form.elements[key].value = values[key]; });
    $("#item-fields").disabled = !canWrite(); $("#save-item").hidden = !canWrite();
    $("#item-dialog-title").textContent = !canWrite() ? "รายละเอียดรายการ" : record ? "แก้ไขรายการ" : "เพิ่มรายการ";
    $("#item-error").textContent = ""; $("#item-dialog").showModal();
  }
  function openUser(record) {
    state.editing = record;
    const form = $("#user-form");
    form.elements.name.value = record.name; form.elements.role.value = record.role; form.elements.active.checked = record.active;
    $("#user-error").textContent = ""; $("#user-dialog").showModal();
  }
  async function submit(event, errorSelector, task) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true; $(errorSelector).textContent = "";
    try { await task(); } catch (error) { $(errorSelector).textContent = error.message; }
    finally { button.disabled = false; }
  }
  $("#login-form").addEventListener("submit", (event) => {
    const form = event.currentTarget;
    submit(event, "#login-error", async () => {
      try { await API.login(form.elements.identity.value.trim(), form.elements.password.value); }
      catch (error) { if (error.status === 400) throw new Error("อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกปิดใช้งาน"); throw error; }
      form.reset(); setView("items"); await load();
    });
  });
  $("#item-form").addEventListener("submit", (event) => {
    const body = Object.fromEntries(new FormData(event.currentTarget));
    body.title = body.title.trim(); body.quantity = Number(body.quantity);
    submit(event, "#item-error", async () => {
      const date = new Date(body.due_date + "T00:00:00Z");
      if (!body.title || isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== body.due_date) throw new Error("กรุณาระบุชื่อและวันที่ที่ถูกต้อง");
      await API.request(`${endpoint()}${state.editing ? `/${state.editing.id}` : ""}`, { method: state.editing ? "PATCH" : "POST", body });
      $("#item-dialog").close(); tell("บันทึกข้อมูลแล้ว"); await load();
    });
  });
  $("#user-form").addEventListener("submit", (event) => {
    const form = event.currentTarget;
    const body = { name: form.elements.name.value.trim(), role: form.elements.role.value, active: form.elements.active.checked };
    submit(event, "#user-error", async () => {
      if (!body.name) throw new Error("กรุณาระบุชื่อที่แสดง");
      await API.request(`${endpoint()}/${state.editing.id}`, { method: "PATCH", body });
      $("#user-dialog").close(); tell("บันทึกสมาชิกแล้ว"); await load();
    });
  });
  $("#delete-form").addEventListener("submit", (event) => submit(event, "#delete-error", async () => {
    await API.request(`${endpoint()}/${state.deleting.id}`, { method: "DELETE" });
    $("#delete-dialog").close(); tell("ลบรายการแล้ว"); await load();
  }));
  $("#logout").addEventListener("click", () => { API.logout(); sessionUI(); $("#login-error").textContent = ""; });
  window.addEventListener("session-ended", sessionUI);
  $("#add-case-button").addEventListener("click", () => openItem());
  $("#items-tab").addEventListener("click", () => { setView("items"); load(); });
  $("#users-tab").addEventListener("click", () => { setView("users"); load(); });
  $("#search-form").addEventListener("submit", (event) => { event.preventDefault(); state.search = $("#search").value.trim(); state.status = $("#status-filter").value; state.page = 1; load(); });
  $("#previous").addEventListener("click", () => { state.page--; load(); });
  $("#next").addEventListener("click", () => { state.page++; load(); });
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
  document.querySelectorAll("[data-app-name]").forEach((element) => { element.textContent = APP_CONFIG.appName; });
  sessionUI(); if (API.token) load();
})();
