// Master data: patients, implants, vendors, doctors and procedures.
// Each master is a generic list + schema-driven create/edit dialog.
(() => {
  const { node, badge, action, tell, canWrite, quoted, makeList, openFormDialog, fetchOptions } = UI;

  const implantTypeOptions = Object.entries(LABELS.implantType);
  const sexOptions = Object.entries(LABELS.sex);

  const MASTERS = {
    patients: {
      key: "patients", tab: "ผู้ป่วย", addLabel: "+ เพิ่มผู้ป่วย", emptyText: "ยังไม่มีข้อมูลผู้ป่วย",
      title: (record) => `${record.hn} · ${record.name}`,
      meta: (record) => {
        const lines = [];
        if (record.dob || record.sex) lines.push(`เกิด ${record.dob || "-"} · ${LABELS.sex[record.sex] || "ไม่ระบุเพศ"}`);
        if (record.phone) lines.push(`โทร ${record.phone}`);
        if (record.allergies) lines.push(`แพ้ยา: ${record.allergies}`);
        return lines;
      },
      extraBadges: (record) => [record.active ? badge("done", "ใช้งาน") : badge("off", "ปิดใช้งาน")],
      search: (q) => `(hn ~ ${quoted(q)} || name ~ ${quoted(q)})`,
      fields: (record) => [
        { name: "hn", label: "HN", required: true, maxLength: 50, value: record?.hn || "" },
        { name: "name", label: "ชื่อ-นามสกุลผู้ป่วย", required: true, maxLength: 200, value: record?.name || "" },
        { name: "dob", label: "วันเกิด", type: "date", value: record?.dob || "", half: true },
        { name: "sex", label: "เพศ", type: "select", options: sexOptions, value: record?.sex || "" },
        { name: "phone", label: "เบอร์ติดต่อ", maxLength: 30, value: record?.phone || "", half: true },
        { name: "allergies", label: "ประวัติแพ้ยา", maxLength: 500, value: record?.allergies || "" },
        { name: "notes", label: "บันทึกเพิ่มเติม", type: "textarea", rows: 2, maxLength: 2000, value: record?.notes || "" },
        { name: "active", label: "ผู้ป่วย active", type: "checkbox", value: record ? record.active !== false : true },
      ],
      body: (values) => ({ ...values, dob: values.dob || "", sex: values.sex || "", phone: values.phone || "", allergies: values.allergies || "", notes: values.notes || "" }),
    },
    implants: {
      key: "implants", tab: "Implant Master", addLabel: "+ เพิ่ม Implant", emptyText: "ยังไม่มีข้อมูล Implant",
      title: (record) => `${record.product_code} · ${record.brand || ""} ${record.model || ""} ${record.power || ""}`.trim(),
      meta: (record) => {
        const lines = [`${LABELS.implantType[record.implant_type] || record.implant_type}${record.material ? ` · ${record.material}` : ""}`];
        if (record.cylinder) lines.push(`Cylinder ${record.cylinder}${record.a_constant ? ` · A-const ${record.a_constant}` : ""}`);
        if (record.unit_price) lines.push(`ราคา/ชิ้น ${UI.money(record.unit_price)} · Min stock ${record.min_stock ?? 0}`);
        return lines;
      },
      extraBadges: (record) => [badge("info", LABELS.implantType[record.implant_type] || record.implant_type), record.active ? badge("done", "ใช้งาน") : badge("off", "ปิดใช้งาน")],
      search: (q) => `(product_code ~ ${quoted(q)} || brand ~ ${quoted(q)} || model ~ ${quoted(q)})`,
      fields: (record) => [
        { name: "product_code", label: "Product Code", required: true, maxLength: 60, value: record?.product_code || "" },
        { name: "implant_type", label: "ประเภท Implant", type: "select", options: implantTypeOptions, required: true, value: record?.implant_type || "" },
        { name: "brand", label: "Brand", maxLength: 120, value: record?.brand || "", half: true },
        { name: "manufacturer", label: "Manufacturer", maxLength: 200, value: record?.manufacturer || "" },
        { name: "model", label: "Model", maxLength: 200, value: record?.model || "", half: true },
        { name: "material", label: "Material", maxLength: 200, value: record?.material || "" },
        { name: "power", label: "Power", maxLength: 40, placeholder: "เช่น +22.0 D", value: record?.power || "", half: true },
        { name: "cylinder", label: "Cylinder", maxLength: 40, placeholder: "เช่น +1.25 D", value: record?.cylinder || "", half: true },
        { name: "a_constant", label: "A-Constant", maxLength: 40, value: record?.a_constant || "", half: true },
        { name: "unit_price", label: "ราคาต่อชิ้น (บาท)", type: "number", min: 0, step: "0.01", value: record?.unit_price ?? "", half: true },
        { name: "min_stock", label: "Min Stock", type: "number", min: 0, step: 1, value: record?.min_stock ?? 0, half: true },
        { name: "max_stock", label: "Max Stock", type: "number", min: 0, step: 1, value: record?.max_stock ?? 0, half: true },
        { name: "vendor", label: "ร้านค้า / Vendor", type: "select", value: record?.vendor || "", asyncOptions: true },
        { name: "lot_control", label: "ควบคุม Lot", type: "checkbox", value: record ? record.lot_control !== false : true, half: true },
        { name: "serial_control", label: "ควบคุม Serial", type: "checkbox", value: record ? Boolean(record.serial_control) : false, half: true },
        { name: "expiry_control", label: "ควบคุมวันหมดอายุ", type: "checkbox", value: record ? record.expiry_control !== false : true, half: true },
        { name: "active", label: "ใช้งานรายการนี้", type: "checkbox", value: record ? record.active !== false : true },
        { name: "description", label: "รายละเอียด", type: "textarea", rows: 2, maxLength: 2000, value: record?.description || "" },
      ],
      body: (values) => ({
        ...values,
        unit_price: values.unit_price === "" ? null : Number(values.unit_price),
        min_stock: values.min_stock === "" ? null : Number(values.min_stock),
        max_stock: values.max_stock === "" ? null : Number(values.max_stock),
        brand: values.brand || "", manufacturer: values.manufacturer || "", model: values.model || "",
        power: values.power || "", cylinder: values.cylinder || "", a_constant: values.a_constant || "",
        material: values.material || "", description: values.description || "",
      }),
    },
    vendors: {
      key: "vendors", tab: "ร้านค้า / Vendor", addLabel: "+ เพิ่มร้านค้า", emptyText: "ยังไม่มีข้อมูลร้านค้า",
      title: (record) => record.name,
      meta: (record) => {
        const lines = [];
        if (record.contact_name) lines.push(`ผู้ติดต่อ: ${record.contact_name}`);
        if (record.phone || record.email) lines.push(`โทร ${record.phone || "-"} · ${record.email || ""}`);
        return lines;
      },
      extraBadges: (record) => [record.active ? badge("done", "ใช้งาน") : badge("off", "ปิดใช้งาน")],
      search: (q) => `(name ~ ${quoted(q)} || contact_name ~ ${quoted(q)})`,
      fields: (record) => [
        { name: "name", label: "ชื่อร้านค้า", required: true, maxLength: 200, value: record?.name || "" },
        { name: "contact_name", label: "ผู้ติดต่อ", maxLength: 200, value: record?.contact_name || "", half: true },
        { name: "phone", label: "โทรศัพท์", maxLength: 30, value: record?.phone || "", half: true },
        { name: "email", label: "อีเมล", maxLength: 255, value: record?.email || "" },
        { name: "active", label: "ใช้งาน", type: "checkbox", value: record ? record.active !== false : true },
      ],
      body: (values) => ({ ...values, contact_name: values.contact_name || "", phone: values.phone || "", email: values.email || "" }),
    },
    doctors: {
      key: "doctors", tab: "แพทย์", addLabel: "+ เพิ่มแพทย์", emptyText: "ยังไม่มีข้อมูลแพทย์",
      title: (record) => record.name,
      meta: (record) => [record.department ? `แผนก: ${record.department}` : ""].filter(Boolean),
      extraBadges: (record) => [record.active ? badge("done", "ใช้งาน") : badge("off", "ปิดใช้งาน")],
      search: (q) => `(name ~ ${quoted(q)} || department ~ ${quoted(q)})`,
      fields: (record) => [
        { name: "name", label: "ชื่อแพทย์", required: true, maxLength: 200, value: record?.name || "" },
        { name: "department", label: "แผนก / ความเชี่ยวชาญ", maxLength: 200, value: record?.department || "" },
        { name: "active", label: "ใช้งาน", type: "checkbox", value: record ? record.active !== false : true },
      ],
      body: (values) => ({ ...values, department: values.department || "" }),
    },
    procedures: {
      key: "procedures", tab: "หัตถการ", addLabel: "+ เพิ่มหัตถการ", emptyText: "ยังไม่มีข้อมูลหัตถการ",
      title: (record) => record.name,
      meta: (record) => [record.category ? `หมวด: ${record.category}` : ""].filter(Boolean),
      extraBadges: (record) => [record.active ? badge("done", "ใช้งาน") : badge("off", "ปิดใช้งาน")],
      search: (q) => `(name ~ ${quoted(q)} || category ~ ${quoted(q)})`,
      fields: (record) => [
        { name: "name", label: "ชื่อหัตถการ", required: true, maxLength: 200, value: record?.name || "" },
        { name: "category", label: "หมวดหมู่", maxLength: 200, value: record?.category || "" },
        { name: "active", label: "ใช้งาน", type: "checkbox", value: record ? record.active !== false : true },
      ],
      body: (values) => ({ ...values, category: values.category || "" }),
    },
  };

  const section = document.getElementById("view-masters");
  const subTabs = node("nav", "sub-tabs");
  subTabs.setAttribute("aria-label", "หมวดข้อมูลหลัก");
  const containers = {};
  for (const def of Object.values(MASTERS)) {
    const button = node("button", def.key === "patients" ? "selected" : "quiet", def.tab);
    button.type = "button";
    button.dataset.master = def.key;
    button.addEventListener("click", () => activate(def.key));
    subTabs.append(button);
    const container = node("div", "master-container");
    container.hidden = def.key !== "patients";
    containers[def.key] = container;
  }
  section.append(subTabs, ...Object.values(containers));

  const lists = {};
  for (const def of Object.values(MASTERS)) {
    const container = containers[def.key];
    const header = node("div", "master-header");
    header.append(node("p", "muted", def.emptyText.replace("ยังไม่มี", "จัดการข้อมูล")));
    const addButton = node("button", "", def.addLabel);
    addButton.type = "button";
    addButton.addEventListener("click", () => openMasterDialog(def));
    header.append(addButton);
    const listMount = node("div");
    container.append(header, listMount);
    lists[def.key] = makeList({
      mount: listMount,
      view: `masters-${def.key}`,
      placeholder: "ค้นหา…",
      emptyText: def.emptyText,
      buildQuery(state) {
        return { collection: def.key, filter: state.search ? def.search(state.search) : "", sort: def.key === "implants" ? "product_code" : "name" };
      },
      renderRow: (record) => renderMasterRow(def, record),
    });
  }

  function renderMasterRow(def, record) {
    const row = node("article", "record");
    const info = node("div", "record-main");
    info.append(node("h2", "record-title", def.title(record)));
    const lines = def.meta(record);
    if (lines.length) {
      const meta = node("div", "record-meta");
      for (const line of lines) meta.append(node("div", "", line));
      info.append(meta);
    }
    const badges = node("div", "record-badges");
    for (const element of def.extraBadges(record)) badges.append(element);
    const actions = node("div", "record-actions");
    if (canWrite()) {
      actions.append(action("แก้ไข", () => openMasterDialog(def, record)));
      actions.append(action("ลบ", () => UI.confirmDelete({
        collection: def.key,
        id: record.id,
        name: def.title(record),
        note: "รายการที่ถูกอ้างอิงโดย Case หรือคลังจะลบไม่ได้",
        onDone: () => lists[def.key].reload(),
      }), "quiet"));
    }
    row.append(info, badges, actions);
    return row;
  }

  async function openMasterDialog(def, record = null) {
    let fields = def.fields(record);
    // Vendor select needs async options.
    fields = await Promise.all(fields.map(async (field) => {
      if (field.asyncOptions) {
        const options = await fetchOptions("vendors", (item) => item.name).catch(() => []);
        return { ...field, asyncOptions: undefined, options };
      }
      return field;
    }));
    openFormDialog({
      title: `${record ? "แก้ไข" : "เพิ่ม"}${def.tab}`,
      fields,
      wide: def.key === "implants",
      submitLabel: record ? "บันทึกการแก้ไข" : "เพิ่มรายการ",
      onSubmit: async (values) => {
        const body = def.body(values);
        await API.request(`/api/collections/${def.key}/records${record ? `/${record.id}` : ""}`, { method: record ? "PATCH" : "POST", body });
        tell("บันทึกข้อมูลแล้ว");
        lists[def.key].reload();
      },
    });
  }

  function activate(key) {
    for (const [name, container] of Object.entries(containers)) container.hidden = name !== key;
    subTabs.querySelectorAll("button").forEach((button) => {
      button.className = button.dataset.master === key ? "selected" : "quiet";
    });
    refreshPermissions();
    if (API.user) lists[key].reload();
  }

  // Add buttons are static, so their visibility tracks the current role.
  function refreshPermissions() {
    section.querySelectorAll(".master-header button").forEach((button) => { button.hidden = !canWrite(); });
  }

  window.Views = window.Views || {};
  window.Views.masters = {
    load: () => {
      refreshPermissions();
      const active = Object.keys(containers).find((key) => !containers[key].hidden) || "patients";
      lists[active].reload();
    },
    openPatientDialog: (onSaved) => {
      openFormDialog({
        title: "เพิ่มผู้ป่วยใหม่",
        fields: MASTERS.patients.fields(null),
        submitLabel: "เพิ่มผู้ป่วย",
        onSubmit: async (values) => {
          const body = MASTERS.patients.body(values);
          const created = await API.request("/api/collections/patients/records", { method: "POST", body });
          tell("เพิ่มผู้ป่วยแล้ว");
          if (onSaved) onSaved(created);
        },
      });
    },
  };
})();
