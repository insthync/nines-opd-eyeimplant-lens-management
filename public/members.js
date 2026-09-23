// Admin-only member management, ported from the starter users view.
(() => {
  const { node, badge, action, tell, submit, isAdmin, quoted, makeList } = UI;
  let editingUser = null;
  let list;

  function renderRow(record) {
    const row = node("article", "record");
    const info = node("div", "record-main");
    info.append(node("h2", "record-title", record.name));
    const meta = node("div", "record-meta");
    meta.append(node("div", "", `อีเมล: ${record.email}`));
    meta.append(node("div", "", `ID: ${record.id}${API.user && record.id === API.user.id ? " · บัญชีของคุณ" : ""}`));
    info.append(meta);
    const badges = node("div", "record-badges");
    badges.append(badge(record.active ? (record.role === "admin" ? "admin" : record.role === "editor" ? "info" : "") : "off",
      `${LABELS.roles[record.role] || record.role}${record.active ? "" : " · ปิดใช้งาน"}`));
    const actions = node("div", "record-actions");
    if (isAdmin() && record.id !== API.user.id) actions.append(action("แก้ไขสมาชิก", () => openUser(record)));
    row.append(info, badges, actions);
    return row;
  }

  list = makeList({
    view: "members",
    placeholder: "ค้นหาชื่อสมาชิก…",
    emptyText: "ไม่พบสมาชิก",
    buildQuery(state) {
      return {
        collection: "users",
        filter: state.search ? `name ~ ${quoted(state.search)}` : "",
      };
    },
    renderRow,
  });

  function openUser(record) {
    editingUser = record;
    const form = document.querySelector("#user-form");
    form.elements.name.value = record.name;
    form.elements.role.value = record.role;
    form.elements.active.checked = record.active;
    document.querySelector("#user-error").textContent = "";
    document.querySelector("#user-dialog").showModal();
  }

  document.querySelector("#user-form").addEventListener("submit", (event) => {
    const form = event.currentTarget;
    const body = { name: form.elements.name.value.trim(), role: form.elements.role.value, active: form.elements.active.checked };
    submit(event, "#user-error", async () => {
      if (!body.name) throw new Error("กรุณาระบุชื่อที่แสดง");
      await API.request(`/api/collections/users/records/${editingUser.id}`, { method: "PATCH", body });
      document.querySelector("#user-dialog").close();
      tell("บันทึกข้อมูลสมาชิกแล้ว");
      list.reload();
    });
  });

  window.Views = window.Views || {};
  window.Views.members = { load: () => { if (isAdmin()) list.reload(); } };
})();
