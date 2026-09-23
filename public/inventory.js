// Inventory: stock lots with expiry tracking, receiving and adjustments.
(() => {
  const { $, node, badge, action, tell, submit, canWrite, isAdmin, localDate, quoted, expiryState, makeList, fetchOptions, openFormDialog } = UI;

  let list;
  let lotsCache = [];
  let implantAvailable = new Map(); // implantId -> { available, minStock }

  function refreshAggregates() {
    implantAvailable = new Map();
    for (const lot of lotsCache) {
      const entry = implantAvailable.get(lot.implant) || { available: 0 };
      entry.available += (lot.qty_physical || 0) - (lot.qty_reserved || 0);
      implantAvailable.set(lot.implant, entry);
    }
  }

  function stockBadge(record) {
    const entry = implantAvailable.get(record.implant);
    const minStock = Number(record.expand?.implant?.min_stock || 0);
    if (!entry || entry.available <= 0) return badge("problem", "🔴 OUT OF STOCK");
    if (minStock > 0 && entry.available < minStock) return badge("pending", `🟡 LOW STOCK (< ${minStock})`);
    return badge("ready", "🟢 พร้อมใช้");
  }

  function renderStats() {
    const section = $("#view-inventory");
    let stats = section.querySelector(".kpi-grid");
    if (!stats) {
      stats = node("div", "kpi-grid inventory-stats");
      section.prepend(stats);
    }
    const today = localDate();
    let physical = 0, reserved = 0, expiring = 0, expired = 0;
    const lowImplants = [];
    for (const [implantId, entry] of implantAvailable) {
      const implant = lotsCache.find((lot) => lot.implant === implantId)?.expand?.implant;
      const minStock = Number(implant?.min_stock || 0);
      if (entry.available <= 0 || (minStock > 0 && entry.available < minStock)) lowImplants.push(implantId);
    }
    for (const lot of lotsCache) {
      physical += lot.qty_physical || 0;
      reserved += lot.qty_reserved || 0;
      if (lot.expiry) {
        if (lot.expiry <= today) expired += (lot.qty_physical || 0) - (lot.qty_reserved || 0) > 0 ? 1 : 0;
        else if (UI.daysUntil(lot.expiry) <= 30) expiring++;
      }
    }
    const cards = [
      ["Lot ทั้งหมด", String(lotsCache.length), ""],
      ["Stock จริง / จอง / คงเหลือ", `${physical} / ${reserved} / ${physical - reserved}`, ""],
      ["Implant ที่ต้องเติม", String(lowImplants.length), lowImplants.length ? "problem" : "ready"],
      ["ใกล้หมดอายุ (30 วัน)", String(expiring), expiring ? "pending" : "ready"],
      ["Lot หมดอายุแล้ว", String(expired), expired ? "problem" : "ready"],
    ];
    stats.replaceChildren();
    for (const [label, value, kind] of cards) {
      const card = node("div", `kpi-card ${kind}`);
      card.append(node("span", "kpi-num", value), node("span", "kpi-label", label));
      stats.append(card);
    }
  }

  function renderRow(record) {
    const row = node("article", "record");
    const info = node("div", "record-main");
    const implant = record.expand?.implant;
    info.append(node("h2", "record-title", `${implant?.product_code || "-"} · ${implant?.brand || ""} ${implant?.model || ""} ${implant?.power || ""}`.trim()));
    const meta = node("div", "record-meta");
    meta.append(node("div", "", `Lot ${record.lot || "-"}${record.serial ? ` · Serial ${record.serial}` : ""} · ที่ตั้ง ${record.location || "-"}`));
    meta.append(node("div", "", `จำนวนจริง ${record.qty_physical} · จองอยู่ ${record.qty_reserved} · คงเหลือ ${(record.qty_physical || 0) - (record.qty_reserved || 0)}`));
    if (implant) meta.append(node("div", "", LABELS.implantType[implant.implant_type] || implant.implant_type));
    info.append(meta);

    const badges = node("div", "record-badges");
    badges.append(stockBadge(record));
    badges.append(badge(expiryState(record.expiry).cls, expiryState(record.expiry).label));

    const actions = node("div", "record-actions");
    if (canWrite()) {
      actions.append(action("รับเข้า", () => openReceive(record.implant)));
      actions.append(action("แก้ไข Lot", () => openLotEdit(record)));
    }
    if (isAdmin()) {
      actions.append(action("ลบ", () => UI.confirmDelete({
        collection: "stock_lots", id: record.id,
        name: `${implant?.product_code || ""} Lot ${record.lot || "-"}`,
        note: "Lot ที่ถูกจองอยู่จะลบไม่ได้", onDone: () => list.reload(),
      }), "quiet"));
    }
    row.append(info, badges, actions);
    return row;
  }

  list = makeList({
    view: "inventory",
    placeholder: "ค้นหา Lot / Serial / Product Code / Brand…",
    emptyText: "ยังไม่มี Stock ในคลัง รับเข้าได้จากปุ่ม รับ Implant เข้าคลัง",
    filters: [
      { name: "state", label: "สถานะ", options: [["", "ทั้งหมด"], ["expiring", "ใกล้หมดอายุ (30 วัน)"], ["expired", "หมดอายุแล้ว"]] },
    ],
    buildQuery(state) {
      const filters = [];
      if (state.search) filters.push(`(lot ~ ${quoted(state.search)} || serial ~ ${quoted(state.search)} || implant.product_code ~ ${quoted(state.search)} || implant.brand ~ ${quoted(state.search)} || implant.model ~ ${quoted(state.search)})`);
      const today = localDate();
      if (state.extras.state === "expiring") filters.push(`expiry != "" && expiry > ${quoted(today)} && expiry <= ${quoted(localDate(30))}`);
      if (state.extras.state === "expired") filters.push(`expiry != "" && expiry <= ${quoted(today)}`);
      return { collection: "stock_lots", filter: filters.join(" && "), expand: "implant", sort: "-created" };
    },
    renderRow,
  });

  const baseReload = list.reload;
  list.reload = async () => {
    try {
      const data = await API.records("stock_lots", { page: 1, perPage: 500, sort: "-created", expand: "implant" });
      lotsCache = data.items;
      refreshAggregates();
    } catch { lotsCache = []; }
    renderStats();
    await baseReload();
  };

  // --- receive dialog -------------------------------------------------------------
  async function openReceive(implantId = "") {
    const form = $("#receive-form");
    form.reset();
    const options = await fetchOptions("implants", (item) => `${item.product_code} · ${item.brand || ""} ${item.model || ""} ${item.power || ""}`.trim()).catch(() => []);
    UI.fillSelect($("#receive-implant"), [["", "— เลือก Implant —"], ...options], implantId);
    $("#receive-fields").disabled = false;
    $("#receive-submit").hidden = false;
    $("#receive-error").textContent = "";
    $("#receive-dialog").showModal();
  }

  $("#receive-form").addEventListener("submit", (event) => {
    const body = Object.fromEntries(new FormData(event.currentTarget));
    submit(event, "#receive-error", async () => {
      if (!body.implant) throw new Error("กรุณาเลือก Implant ที่รับเข้า");
      await API.workflow("receive", {
        implant: body.implant, lot: body.lot || "", serial: body.serial || "",
        expiry: body.expiry || "", quantity: Number(body.quantity) || 0, location: body.location || "",
      });
      $("#receive-dialog").close();
      tell("รับเข้าคลังเรียบร้อยแล้ว");
      list.reload();
    });
  });

  // --- lot edit (qty_reserved stays workflow-owned) ---------------------------------
  function openLotEdit(record) {
    openFormDialog({
      title: `แก้ไข Lot ${record.lot || "-"}`,
      message: "จำนวน Reserved ปรับได้ผ่านการยืนยัน/ยกเลิกการจองเท่านั้น",
      fields: [
        { name: "lot", label: "Lot", maxLength: 100, value: record.lot || "", half: true },
        { name: "serial", label: "Serial", maxLength: 100, value: record.serial || "", half: true },
        { name: "expiry", label: "วันหมดอายุ", type: "date", value: record.expiry || "", half: true },
        { name: "qty_physical", label: "จำนวนจริง (นับได้)", type: "number", min: 0, step: 1, required: true, value: record.qty_physical ?? 0, half: true },
        { name: "location", label: "ที่ตั้ง", maxLength: 100, value: record.location || "" },
      ],
      submitLabel: "บันทึกการแก้ไข",
      onSubmit: async (values) => {
        await API.request(`/api/collections/stock_lots/records/${record.id}`, {
          method: "PATCH",
          body: { lot: values.lot || "", serial: values.serial || "", expiry: values.expiry || "", qty_physical: Number(values.qty_physical) || 0, location: values.location || "" },
        });
        tell("บันทึกการแก้ไข Lot แล้ว");
        list.reload();
      },
    });
  }

  window.Views = window.Views || {};
  window.Views.inventory = { load: () => list.reload(), openReceive };
})();
