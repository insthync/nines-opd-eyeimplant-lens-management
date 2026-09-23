routerAdd(
  "POST",
  "/api/starter/register",
  (e) => {
    const body = e.requestInfo().body || {};
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const passwordConfirm = String(body.passwordConfirm || "");

    if (String(body.website || "")) {
      throw new BadRequestError("ไม่สามารถสร้างบัญชีได้");
    }
    if (!name || !email || !password || !passwordConfirm) {
      throw new BadRequestError("กรุณากรอกข้อมูลให้ครบทุกช่อง");
    }
    if (name.length > 120) {
      throw new BadRequestError("ชื่อต้องไม่เกิน 120 ตัวอักษร");
    }
    if (email.length > 255) {
      throw new BadRequestError("อีเมลยาวเกินไป");
    }
    if (password.length < 8) {
      throw new BadRequestError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
    }
    if (password.length > 72) {
      throw new BadRequestError("รหัสผ่านต้องไม่เกิน 72 ตัวอักษร");
    }
    if (password !== passwordConfirm) {
      throw new BadRequestError("รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน");
    }

    const collection = e.app.findCollectionByNameOrId("users");
    const record = new Record(collection);
    record.set("name", name);
    record.set("email", email);
    record.set("emailVisibility", false);
    record.set("password", password);
    record.set("passwordConfirm", passwordConfirm);
    record.set("role", "viewer");
    record.set("active", true);
    record.set("verified", false);

    try {
      e.app.save(record);
    } catch (error) {
      throw new BadRequestError(
        "ไม่สามารถสร้างบัญชีได้ อีเมลนี้อาจถูกใช้งานแล้วหรือข้อมูลไม่ถูกต้อง",
      );
    }

    return e.json(201, {
      id: record.id,
      name: record.getString("name"),
      email: record.getString("email"),
      role: record.getString("role"),
      active: record.getBool("active"),
    });
  },
  $apis.bodyLimit(16384),
);
