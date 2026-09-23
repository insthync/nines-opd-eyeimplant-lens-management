// OPD Eye Implant & Lens Management System schema.
// Extends the starter users model with the clinical collections and removes
// the generic starter "items" collection (recreated by the down migration).
migrate((app) => {
  const active = '@request.auth.id != "" && @request.auth.collectionName = "users" && @request.auth.active = true';
  const admin = `(${active}) && @request.auth.role = "admin"`;
  const writer = `(${active}) && (@request.auth.role = "editor" || @request.auth.role = "admin")`;
  const users = app.findCollectionByNameOrId("users");
  const datePattern = "^\\d{4}-\\d{2}-\\d{2}$";
  const stamps = [
    { type: "autodate", name: "created", onCreate: true },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ];
  // app.save() does not return the persisted model, so fetch it back by name.
  const saveCollection = (config) => {
    app.save(new Collection(config));
    return app.findCollectionByNameOrId(config.name);
  };

  const patients = saveCollection({
    type: "base", name: "patients",
    listRule: active, viewRule: active, createRule: writer, updateRule: writer, deleteRule: writer,
    fields: [
      { type: "text", name: "hn", required: true, max: 50 },
      { type: "text", name: "name", required: true, max: 200, presentable: true },
      { type: "text", name: "dob", pattern: datePattern, min: 10, max: 10 },
      { type: "select", name: "sex", maxSelect: 1, values: ["male", "female", "other"] },
      { type: "text", name: "phone", max: 30 },
      { type: "text", name: "allergies", max: 500 },
      { type: "text", name: "notes", max: 2000 },
      { type: "bool", name: "active" },
      ...stamps,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_patients_hn ON patients (hn)"],
  });

  const vendors = saveCollection({
    type: "base", name: "vendors",
    listRule: active, viewRule: active, createRule: writer, updateRule: writer, deleteRule: writer,
    fields: [
      { type: "text", name: "name", required: true, max: 200, presentable: true },
      { type: "text", name: "contact_name", max: 200 },
      { type: "text", name: "phone", max: 30 },
      { type: "text", name: "email", max: 255 },
      { type: "bool", name: "active" },
      ...stamps,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_vendors_name ON vendors (name)"],
  });

  const doctors = saveCollection({
    type: "base", name: "doctors",
    listRule: active, viewRule: active, createRule: writer, updateRule: writer, deleteRule: writer,
    fields: [
      { type: "text", name: "name", required: true, max: 200, presentable: true },
      { type: "text", name: "department", max: 200 },
      { type: "bool", name: "active" },
      ...stamps,
    ],
  });

  const procedures = saveCollection({
    type: "base", name: "procedures",
    listRule: active, viewRule: active, createRule: writer, updateRule: writer, deleteRule: writer,
    fields: [
      { type: "text", name: "name", required: true, max: 200, presentable: true },
      { type: "text", name: "category", max: 200 },
      { type: "bool", name: "active" },
      ...stamps,
    ],
  });

  const implants = saveCollection({
    type: "base", name: "implants",
    listRule: active, viewRule: active, createRule: writer, updateRule: writer, deleteRule: writer,
    fields: [
      { type: "text", name: "product_code", required: true, max: 60 },
      { type: "select", name: "implant_type", required: true, maxSelect: 1, values: ["standard_iol", "toric_iol", "multifocal_iol", "edof_iol", "phakic_iol", "glaucoma_implant", "retinal_implant", "other"] },
      { type: "text", name: "brand", max: 120 },
      { type: "text", name: "manufacturer", max: 200 },
      { type: "text", name: "model", max: 200 },
      { type: "text", name: "power", max: 40 },
      { type: "text", name: "cylinder", max: 40 },
      { type: "text", name: "a_constant", max: 40 },
      { type: "text", name: "material", max: 200 },
      { type: "text", name: "description", max: 2000 },
      { type: "number", name: "unit_price", min: 0, max: 100000000 },
      { type: "number", name: "min_stock", min: 0, max: 1000000, onlyInt: true },
      { type: "number", name: "max_stock", min: 0, max: 1000000, onlyInt: true },
      { type: "relation", name: "vendor", collectionId: vendors.id, maxSelect: 1, cascadeDelete: false },
      { type: "bool", name: "lot_control" },
      { type: "bool", name: "serial_control" },
      { type: "bool", name: "expiry_control" },
      { type: "bool", name: "active" },
      ...stamps,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_implants_code ON implants (product_code)"],
  });

  const stockLots = saveCollection({
    type: "base", name: "stock_lots",
    listRule: active, viewRule: active, createRule: writer, updateRule: writer, deleteRule: admin,
    fields: [
      { type: "relation", name: "implant", collectionId: implants.id, required: true, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "lot", max: 100 },
      { type: "text", name: "serial", max: 100 },
      { type: "text", name: "expiry", pattern: datePattern, min: 10, max: 10 },
      { type: "number", name: "qty_physical", required: true, min: 0, max: 1000000, onlyInt: true },
      { type: "number", name: "qty_reserved", min: 0, max: 1000000, onlyInt: true },
      { type: "text", name: "location", max: 100 },
      ...stamps,
    ],
    indexes: ["CREATE INDEX idx_stock_lots_implant ON stock_lots (implant)"],
  });

  const surgeryCases = saveCollection({
    type: "base", name: "surgery_cases",
    listRule: active, viewRule: active, createRule: writer, updateRule: writer, deleteRule: admin,
    fields: [
      { type: "text", name: "case_number", required: true, max: 40, presentable: true },
      { type: "relation", name: "patient", collectionId: patients.id, required: true, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "surgery_date", required: true, pattern: datePattern, min: 10, max: 10 },
      { type: "text", name: "surgery_time", pattern: "^\\d{2}:\\d{2}$", min: 5, max: 5 },
      { type: "select", name: "eye", required: true, maxSelect: 1, values: ["od", "os", "ou"] },
      { type: "relation", name: "surgeon", collectionId: doctors.id, maxSelect: 1, cascadeDelete: false },
      { type: "relation", name: "procedure", collectionId: procedures.id, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "diagnosis", max: 500 },
      { type: "text", name: "or_room", max: 40 },
      { type: "select", name: "priority", maxSelect: 1, values: ["normal", "urgent"] },
      { type: "select", name: "status", required: true, maxSelect: 1, values: ["draft", "confirmed", "or_verified", "completed", "cancelled"] },
      { type: "relation", name: "created_by", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "notes", max: 2000 },
      ...stamps,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_surgery_cases_number ON surgery_cases (case_number)",
      "CREATE INDEX idx_surgery_cases_date ON surgery_cases (surgery_date)",
    ],
  });

  const reservations = saveCollection({
    type: "base", name: "reservations",
    listRule: active, viewRule: active, createRule: writer,
    updateRule: `${writer} && status = "draft"`,
    deleteRule: `${writer} && (status = "draft" || @request.auth.role = "admin")`,
    fields: [
      { type: "text", name: "reservation_number", required: true, max: 40, presentable: true },
      { type: "relation", name: "case", collectionId: surgeryCases.id, required: true, maxSelect: 1, cascadeDelete: false },
      { type: "relation", name: "implant", collectionId: implants.id, required: true, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "power_snapshot", max: 40 },
      { type: "text", name: "cylinder_snapshot", max: 40 },
      { type: "number", name: "quantity", required: true, min: 1, max: 100, onlyInt: true },
      { type: "select", name: "status", required: true, maxSelect: 1, values: ["draft", "first_checked", "verified", "confirmed", "used", "cancelled"] },
      { type: "relation", name: "first_checker", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "first_check_at", max: 40 },
      { type: "relation", name: "second_checker", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "second_check_at", max: 40 },
      { type: "relation", name: "confirmed_by", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "confirmed_at", max: 40 },
      { type: "relation", name: "confirmed_lot", collectionId: stockLots.id, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "cancel_reason", max: 500 },
      { type: "relation", name: "created_by", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      ...stamps,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_reservations_number ON reservations (reservation_number)",
      "CREATE INDEX idx_reservations_case ON reservations (case)",
    ],
  });

  app.save(new Collection({
    type: "base", name: "implant_usages",
    listRule: active, viewRule: active, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "case", collectionId: surgeryCases.id, required: true, maxSelect: 1, cascadeDelete: false },
      { type: "relation", name: "reservation", collectionId: reservations.id, maxSelect: 1, cascadeDelete: false },
      { type: "relation", name: "patient", collectionId: patients.id, required: true, maxSelect: 1, cascadeDelete: false },
      { type: "relation", name: "implant", collectionId: implants.id, required: true, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "lot", max: 100 },
      { type: "text", name: "serial", max: 100 },
      { type: "text", name: "expiry", pattern: datePattern, min: 10, max: 10 },
      { type: "text", name: "power", max: 40 },
      { type: "text", name: "remark", max: 1000 },
      { type: "relation", name: "used_by", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { type: "autodate", name: "used_at", onCreate: true },
    ],
    indexes: [
      "CREATE INDEX idx_implant_usages_lot ON implant_usages (lot)",
      "CREATE INDEX idx_implant_usages_patient ON implant_usages (patient)",
    ],
  }));

  app.save(new Collection({
    type: "base", name: "case_logs",
    listRule: active, viewRule: active, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "case", collectionId: surgeryCases.id, maxSelect: 1, cascadeDelete: false },
      { type: "relation", name: "reservation", collectionId: reservations.id, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "action", required: true, max: 60 },
      { type: "text", name: "detail", max: 1000 },
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { type: "autodate", name: "created", onCreate: true },
    ],
    indexes: ["CREATE INDEX idx_case_logs_case ON case_logs (case, created)"],
  }));

  app.delete(app.findCollectionByNameOrId("items"));

  const settings = app.settings();
  settings.meta.appName = "OPD Eye Implant & Lens Management";
  app.save(settings);
}, (app) => {
  const active = '@request.auth.id != "" && @request.auth.collectionName = "users" && @request.auth.active = true';
  const writer = `(${active}) && (@request.auth.role = "editor" || @request.auth.role = "admin")`;
  for (const name of ["case_logs", "implant_usages", "reservations", "surgery_cases", "stock_lots", "implants", "procedures", "doctors", "vendors", "patients"]) {
    app.delete(app.findCollectionByNameOrId(name));
  }
  app.save(new Collection({
    type: "base", name: "items",
    listRule: active, viewRule: active, createRule: writer, updateRule: writer, deleteRule: writer,
    fields: [
      { type: "text", name: "title", required: true, max: 200, presentable: true },
      { type: "text", name: "description", max: 4000 },
      { type: "number", name: "quantity", min: 0, max: 1000000, onlyInt: true },
      { type: "text", name: "due_date", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$", min: 10, max: 10 },
      { type: "select", name: "status", required: true, maxSelect: 1, values: ["todo", "doing", "done"] },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_items_created ON items (created)"],
  }));
  const settings = app.settings();
  settings.meta.appName = "pb-crud-app-starter";
  app.save(settings);
});
