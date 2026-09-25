// Workflow routes for the implant lifecycle: two-person verification,
// confirmation with stock reservation, cancellation with stock release,
// OR verification, usage with stock deduction and traceability, receiving
// and whole-case cancellation.
//
// NOTE: PocketBase re-evaluates JSVM callbacks in their own context, so this
// entire dispatcher is one self-contained handler (all helpers are local).

routerAdd("POST", "/api/eyeimplant/{action}", (e) => {
  const action = e.request.pathValue("action");
  const body = e.requestInfo().body || {};

  // goja's Intl support is limited, so derive Bangkok wall time from UTC+7.
  const nowStamp = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const todayStamp = () => nowStamp().slice(0, 10);
  const displayName = (auth) => (auth ? auth.getString("name") || auth.email || auth.id : "");
  const requireWriter = () => {
    const auth = e.auth;
    if (!auth) throw new ForbiddenError("กรุณาเข้าสู่ระบบก่อนดำเนินการ");
    const collectionName = auth.collection().name;
    if (collectionName === "_superusers") return auth;
    if (collectionName !== "users" || !auth.getBool("active")) throw new ForbiddenError("บัญชีนี้ไม่มีสิทธิ์ดำเนินการ");
    const role = auth.getString("role");
    if (role !== "editor" && role !== "admin") throw new ForbiddenError("ต้องใช้สิทธิ์ผู้แก้ไขหรือผู้ดูแลในการดำเนินการนี้");
    return auth;
  };
  const find = (app, collectionName, id) => {
    try { return app.findRecordById(collectionName, id); }
    catch { throw new NotFoundError("ไม่พบข้อมูลที่ต้องการดำเนินการ"); }
  };
  const reservationsOf = (app, caseId) => app.findRecordsByFilter("reservations", `case = "${caseId}"`, "", 0, 0);
  const writeLog = (app, logAction, caseId, reservationId, auth, detail) => {
    const collection = app.findCollectionByNameOrId("case_logs");
    const record = new Record(collection);
    record.set("action", logAction);
    if (caseId) record.set("case", caseId);
    if (reservationId) record.set("reservation", reservationId);
    if (auth) record.set("user", auth.id);
    record.set("detail", detail || "");
    app.save(record);
  };
  const lotAvailable = (lot) => (lot.getInt("qty_physical") || 0) - (lot.getInt("qty_reserved") || 0);
  const lotExpired = (lot, today) => {
    const expiry = lot.getString("expiry");
    return Boolean(expiry) && expiry <= today;
  };
  const isValidDate = (value) => {
    const date = new Date(value + "T00:00:00Z");
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };

  // --- two-person verification -----------------------------------------------
  if (action === "verify") {
    const auth = requireWriter();
    const reservation = find(e.app, "reservations", String(body.reservation || ""));
    const caseRecord = find(e.app, "surgery_cases", reservation.getString("case"));
    const caseStatus = caseRecord.getString("status");
    if (caseStatus === "cancelled" || caseStatus === "completed") {
      throw new BadRequestError("Case นี้ถูกยกเลิกหรือเสร็จสิ้นแล้ว ไม่สามารถบันทึกการตรวจสอบได้");
    }
    const stage = String(body.stage || "");
    const status = reservation.getString("status");
    const now = nowStamp();
    if (stage === "first") {
      if (status !== "draft") throw new BadRequestError("บันทึกการตรวจสอบครั้งที่ 1 ได้เฉพาะการจองสถานะร่างเท่านั้น");
      reservation.set("first_checker", auth.id);
      reservation.set("first_check_at", now);
      reservation.set("status", "first_checked");
      writeLog(e.app, "first_check", caseRecord.id, reservation.id, auth, `ตรวจสอบครั้งที่ 1 โดย ${displayName(auth)} (${now})`);
    } else if (stage === "second") {
      if (status !== "first_checked") throw new BadRequestError("ต้องบันทึกการตรวจสอบครั้งที่ 1 ก่อนดำเนินการต่อ");
      if (reservation.getString("first_checker") === auth.id) {
        throw new BadRequestError("การตรวจสอบครั้งที่ 2 ต้องทำโดยบุคคลที่แตกต่างจากผู้ตรวจสอบครั้งที่ 1");
      }
      reservation.set("second_checker", auth.id);
      reservation.set("second_check_at", now);
      reservation.set("status", "verified");
      writeLog(e.app, "second_check", caseRecord.id, reservation.id, auth, `ตรวจสอบครั้งที่ 2 โดย ${displayName(auth)} (${now})`);
    } else {
      throw new BadRequestError("รูปแบบการตรวจสอบไม่ถูกต้อง");
    }
    e.app.save(reservation);
    return e.json(200, { id: reservation.id, status: reservation.getString("status") });
  }

  // --- confirmation (reserves stock) -------------------------------------------
  if (action === "confirm") {
    const auth = requireWriter();
    const reservation = find(e.app, "reservations", String(body.reservation || ""));
    if (reservation.getString("status") !== "verified") {
      throw new BadRequestError("การจองนี้ยังไม่ผ่านการตรวจสอบ 2 คน ไม่สามารถยืนยันได้");
    }
    const caseRecord = find(e.app, "surgery_cases", reservation.getString("case"));
    const caseStatus = caseRecord.getString("status");
    if (caseStatus === "cancelled" || caseStatus === "completed") {
      throw new BadRequestError("Case นี้ถูกยกเลิกหรือเสร็จสิ้นแล้ว ไม่สามารถยืนยันการจองได้");
    }
    const quantity = reservation.getInt("quantity");
    const today = todayStamp();
    const lots = e.app.findRecordsByFilter("stock_lots", `implant = "${reservation.getString("implant")}"`, "", 0, 0);
    let lot = null;
    if (body.lot) {
      lot = lots.find((row) => row.id === String(body.lot)) || null;
      if (!lot) throw new BadRequestError("Lot ที่เลือกไม่ตรงกับ Implant ของการจองนี้");
      if (lotExpired(lot, today)) throw new BadRequestError("Implant ใน Lot นี้หมดอายุแล้ว ไม่สามารถยืนยันการจองได้");
      if (lotAvailable(lot) < quantity) throw new BadRequestError(`Stock ของ Lot นี้ไม่พอ (คงเหลือ ${lotAvailable(lot)} ชิ้น)`);
    } else {
      const usable = lots
        .filter((row) => !lotExpired(row, today) && lotAvailable(row) >= quantity)
        .sort((a, b) => (a.getString("expiry") || "9999-12-31").localeCompare(b.getString("expiry") || "9999-12-31"));
      lot = usable[0] || null;
      if (!lot) {
        let code = "-";
        try { code = e.app.findRecordById("implants", reservation.getString("implant")).getString("product_code") || "-"; } catch {}
        const expiredCount = lots.filter((row) => lotExpired(row, today)).length;
        const shortCount = lots.length - expiredCount;
        if (!lots.length) {
          throw new BadRequestError(`ยังไม่มี Lot ของ ${code} ในคลัง กรุณารับเข้าคลังก่อนยืนยัน (ตรวจด้วยว่าการจองเลือก Implant ตัวเดียวกับที่รับเข้าจริง)`);
        }
        throw new BadRequestError(`Stock ที่ใช้ได้ของ ${code} ไม่พอ (มี ${lots.length} lot: หมดอายุ ${expiredCount} lot, คงเหลือไม่พอ ${shortCount} lot) กรุณาตรวจหน้าคลัง`);
      }
    }
    const now = nowStamp();
    const chosenLotId = lot.id;
    e.app.runInTransaction((tx) => {
      const freshLot = tx.findRecordById("stock_lots", chosenLotId);
      if (lotAvailable(freshLot) < quantity) throw new BadRequestError("Stock ไม่พอ (มีการจองอื่นเข้ามาก่อน) กรุณาลองใหม่");
      freshLot.set("qty_reserved", (freshLot.getInt("qty_reserved") || 0) + quantity);
      tx.save(freshLot);
      reservation.set("status", "confirmed");
      reservation.set("confirmed_by", auth.id);
      reservation.set("confirmed_at", now);
      reservation.set("confirmed_lot", freshLot.id);
      tx.save(reservation);
      if (caseRecord.getString("status") === "draft") {
        caseRecord.set("status", "confirmed");
        tx.save(caseRecord);
      }
      writeLog(tx, "reservation_confirmed", caseRecord.id, reservation.id, auth,
        `ยืนยันการจองและ Reserve Stock · Lot ${freshLot.getString("lot") || "-"} · จำนวน ${quantity} ชิ้น โดย ${displayName(auth)} (${now})`);
    });
    return e.json(200, { id: reservation.id, status: "confirmed", lot: chosenLotId });
  }

  // --- reservation cancellation (releases reserved stock) ------------------------
  if (action === "cancel-reservation") {
    const auth = requireWriter();
    const reservation = find(e.app, "reservations", String(body.reservation || ""));
    const status = reservation.getString("status");
    if (!["draft", "first_checked", "verified", "confirmed"].includes(status)) {
      throw new BadRequestError("การจองนี้ไม่สามารถยกเลิกได้");
    }
    const reason = String(body.reason || "").trim();
    if (!reason) throw new BadRequestError("กรุณาระบุเหตุผลในการยกเลิก");
    const caseRecord = find(e.app, "surgery_cases", reservation.getString("case"));
    const quantity = reservation.getInt("quantity");
    const now = nowStamp();
    const reservationId = reservation.id;
    e.app.runInTransaction((tx) => {
      if (status === "confirmed") {
        const lotId = reservation.getString("confirmed_lot");
        if (lotId) {
          const lot = tx.findRecordById("stock_lots", lotId);
          lot.set("qty_reserved", Math.max(0, (lot.getInt("qty_reserved") || 0) - quantity));
          tx.save(lot);
        }
      }
      reservation.set("status", "cancelled");
      reservation.set("cancel_reason", reason.slice(0, 500));
      tx.save(reservation);
      const others = reservationsOf(tx, caseRecord.id);
      const stillActive = others.some((row) => ["confirmed", "used"].includes(row.getString("status")));
      if (!stillActive && ["confirmed", "or_verified"].includes(caseRecord.getString("status"))) {
        caseRecord.set("status", "draft");
        tx.save(caseRecord);
      }
      writeLog(tx, "reservation_cancelled", caseRecord.id, reservationId, auth, `ยกเลิกการจอง เหตุผล: ${reason} โดย ${displayName(auth)} (${now})`);
    });
    return e.json(200, { id: reservation.id, status: "cancelled" });
  }

  // --- OR final check --------------------------------------------------------------
  if (action === "or-verify") {
    const auth = requireWriter();
    const caseRecord = find(e.app, "surgery_cases", String(body.case || ""));
    if (caseRecord.getString("status") !== "confirmed") {
      throw new BadRequestError("Case นี้ยังไม่ได้รับการยืนยัน ไม่สามารถบันทึก OR Verified ได้");
    }
    const confirmed = reservationsOf(e.app, caseRecord.id).some((row) => row.getString("status") === "confirmed");
    if (!confirmed) throw new BadRequestError("Case นี้ไม่มีการจอง Implant ที่ยืนยันแล้ว");
    const now = nowStamp();
    caseRecord.set("status", "or_verified");
    e.app.save(caseRecord);
    writeLog(e.app, "or_verified", caseRecord.id, "", auth, `บันทึก OR Verified โดย ${displayName(auth)} (${now})`);
    return e.json(200, { id: caseRecord.id, status: "or_verified" });
  }

  // --- usage record (deducts stock, writes traceability) ---------------------------
  if (action === "use") {
    const auth = requireWriter();
    const reservation = find(e.app, "reservations", String(body.reservation || ""));
    if (reservation.getString("status") !== "confirmed") throw new BadRequestError("ต้องยืนยันการจองก่อนบันทึกการใช้ Implant");
    const caseRecord = find(e.app, "surgery_cases", reservation.getString("case"));
    if (caseRecord.getString("status") !== "or_verified") {
      throw new BadRequestError("ต้องบันทึก OR Verified ของ Case นี้ก่อนใช้ Implant");
    }
    const lotId = reservation.getString("confirmed_lot");
    if (!lotId) throw new BadRequestError("การจองนี้ไม่มี Lot ที่ถูก Reserve กรุณาติดต่อผู้ดูแลระบบ");
    const quantity = reservation.getInt("quantity");
    const today = todayStamp();
    const now = nowStamp();
    const reservationId = reservation.id;
    let usageId = "";
    e.app.runInTransaction((tx) => {
      const lot = tx.findRecordById("stock_lots", lotId);
      if (lotExpired(lot, today)) throw new BadRequestError("Implant ใน Lot นี้หมดอายุแล้ว ห้ามใช้งาน");
      if ((lot.getInt("qty_physical") || 0) < quantity) throw new BadRequestError("Stock จริงไม่พอสำหรับการตัดสต๊อก");
      lot.set("qty_physical", (lot.getInt("qty_physical") || 0) - quantity);
      lot.set("qty_reserved", Math.max(0, (lot.getInt("qty_reserved") || 0) - quantity));
      tx.save(lot);

      const usageCollection = tx.findCollectionByNameOrId("implant_usages");
      const usage = new Record(usageCollection);
      usage.set("case", caseRecord.id);
      usage.set("reservation", reservation.id);
      usage.set("patient", caseRecord.getString("patient"));
      usage.set("implant", reservation.getString("implant"));
      usage.set("lot", lot.getString("lot"));
      usage.set("serial", String(body.serial || "") || lot.getString("serial"));
      usage.set("expiry", lot.getString("expiry"));
      usage.set("power", String(body.power || "") || reservation.getString("power_snapshot"));
      usage.set("remark", String(body.remark || "").slice(0, 1000));
      usage.set("used_by", auth.id);
      tx.save(usage);
      usageId = usage.id;

      reservation.set("status", "used");
      tx.save(reservation);

      const others = reservationsOf(tx, caseRecord.id);
      const allSettled = others.every((row) => ["used", "cancelled"].includes(row.getString("status")));
      if (allSettled) {
        caseRecord.set("status", "completed");
        tx.save(caseRecord);
      }
      writeLog(tx, "implant_used", caseRecord.id, reservationId, auth,
        `ใช้ Implant · Lot ${lot.getString("lot") || "-"} · Serial ${usage.getString("serial") || "-"} · Power ${usage.getString("power") || "-"} โดย ${displayName(auth)} (${now})`);
    });
    return e.json(200, { id: usageId, caseStatus: caseRecord.getString("status") });
  }

  // --- receiving (stock intake without PO) -------------------------------------------
  if (action === "receive") {
    const auth = requireWriter();
    const implant = find(e.app, "implants", String(body.implant || ""));
    const lot = String(body.lot || "").trim().slice(0, 100);
    const serial = String(body.serial || "").trim().slice(0, 100);
    const expiry = String(body.expiry || "").trim();
    const location = String(body.location || "").trim().slice(0, 100);
    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) throw new BadRequestError("จำนวนที่รับเข้าต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
    if (expiry && !isValidDate(expiry)) throw new BadRequestError("วันหมดอายุไม่ถูกต้อง");
    const now = nowStamp();
    let lotId = "";
    e.app.runInTransaction((tx) => {
      const existing = tx.findRecordsByFilter("stock_lots", `implant = "${implant.id}"`, "", 0, 0)
        .find((row) => row.getString("lot") === lot && row.getString("serial") === serial && row.getString("expiry") === expiry);
      if (existing) {
        existing.set("qty_physical", (existing.getInt("qty_physical") || 0) + quantity);
        if (location) existing.set("location", location);
        tx.save(existing);
        lotId = existing.id;
      } else {
        const collection = tx.findCollectionByNameOrId("stock_lots");
        const record = new Record(collection);
        record.set("implant", implant.id);
        record.set("lot", lot);
        record.set("serial", serial);
        record.set("expiry", expiry);
        record.set("qty_physical", quantity);
        record.set("qty_reserved", 0);
        record.set("location", location);
        tx.save(record);
        lotId = record.id;
      }
      writeLog(tx, "stock_received", "", "", auth, `รับเข้า ${implant.getString("product_code")} · Lot ${lot || "-"} · ${quantity} ชิ้น โดย ${displayName(auth)} (${now})`);
    });
    return e.json(200, { id: lotId });
  }

  // --- whole-case cancellation ---------------------------------------------------------
  if (action === "cancel-case") {
    const auth = requireWriter();
    const caseRecord = find(e.app, "surgery_cases", String(body.case || ""));
    const status = caseRecord.getString("status");
    if (!["draft", "confirmed", "or_verified"].includes(status)) {
      throw new BadRequestError("Case นี้ไม่สามารถยกเลิกได้");
    }
    const reason = String(body.reason || "").trim();
    if (!reason) throw new BadRequestError("กรุณาระบุเหตุผลในการยกเลิก Case");
    const now = nowStamp();
    const caseId = caseRecord.id;
    e.app.runInTransaction((tx) => {
      for (const row of reservationsOf(tx, caseId)) {
        const rowStatus = row.getString("status");
        if (rowStatus === "confirmed") {
          const rowLotId = row.getString("confirmed_lot");
          if (rowLotId) {
            const lot = tx.findRecordById("stock_lots", rowLotId);
            lot.set("qty_reserved", Math.max(0, (lot.getInt("qty_reserved") || 0) - row.getInt("quantity")));
            tx.save(lot);
          }
        }
        if (["draft", "first_checked", "verified", "confirmed"].includes(rowStatus)) {
          row.set("status", "cancelled");
          row.set("cancel_reason", `Case ถูกยกเลิก: ${reason}`.slice(0, 500));
          tx.save(row);
        }
      }
      caseRecord.set("status", "cancelled");
      tx.save(caseRecord);
      writeLog(tx, "case_cancelled", caseId, "", auth, `ยกเลิก Case เหตุผล: ${reason} โดย ${displayName(auth)} (${now})`);
    });
    return e.json(200, { id: caseRecord.id, status: "cancelled" });
  }

  throw new NotFoundError("ไม่พบขั้นตอนที่ร้องขอ");
}, $apis.bodyLimit(16384));
