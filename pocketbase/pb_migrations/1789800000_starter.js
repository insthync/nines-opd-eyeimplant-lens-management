migrate((app) => {
  const active = '@request.auth.id != "" && @request.auth.collectionName = "users" && @request.auth.active = true';
  const admin = `(${active}) && @request.auth.role = "admin"`;
  const writer = `(${active}) && (@request.auth.role = "editor" || @request.auth.role = "admin")`;
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(
    new TextField({ name: "name", required: true, max: 120, presentable: true }),
    new SelectField({ name: "role", required: true, maxSelect: 1, values: ["viewer", "editor", "admin"] }),
    new BoolField({ name: "active" }),
  );
  users.listRule = users.viewRule = `(${active}) && (id = @request.auth.id || @request.auth.role = "admin")`;
  users.createRule = null;
  users.updateRule = `(${admin}) && id != @request.auth.id`;
  users.deleteRule = null;
  users.manageRule = null;
  users.authRule = 'active = true';
  users.passwordAuth.enabled = true;
  users.passwordAuth.identityFields = ["email"];
  app.save(users);
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
}, (app) => {
  app.delete(app.findCollectionByNameOrId("items"));
  const users = app.findCollectionByNameOrId("users");
  ["name", "role", "active"].forEach((name) => users.fields.removeByName(name));
  users.listRule = users.viewRule = users.createRule = users.updateRule = users.deleteRule = users.manageRule = null;
  users.authRule = "";
  app.save(users);
});
