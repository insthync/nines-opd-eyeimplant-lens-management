// API rules authorize the update. This hook limits the admin's editable fields.
onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const allowed = ["name", "role", "active"];
    const body = e.requestInfo().body || {};
    if (Object.keys(body).some((key) => allowed.indexOf(key) === -1)) {
      throw new BadRequestError("แก้ไขได้เฉพาะชื่อ สิทธิ์ และสถานะบัญชี");
    }
  }
  e.next();
}, "users");

// Validate real calendar dates, including leap years, on both create and update.
function validateItem(e) {
  const title = e.record.getString("title").trim();
  const value = e.record.getString("due_date");
  const date = new Date(value + "T00:00:00Z");
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestError("กรุณาระบุชื่อและวันที่ที่ถูกต้อง");
  }
  e.record.set("title", title);
  e.next();
}
onRecordCreateRequest(validateItem, "items");
onRecordUpdateRequest(validateItem, "items");
