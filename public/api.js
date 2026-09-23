(() => {
  const base = window.APP_CONFIG.pocketBaseUrl.replace(/\/$/, "");
  const key = `pb-crud-app-starter:${base}:session`;
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(key)); } catch { sessionStorage.removeItem(key); }
  const setSession = (value) => {
    session = value;
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  };
  async function request(path, options = {}) {
    const headers = { ...options.headers };
    if (session?.token) headers.Authorization = session.token;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try { response = await fetch(base + path, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }); }
    catch { throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่"); }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) { setSession(null); window.dispatchEvent(new Event("session-ended")); }
      const error = new Error(response.status === 401 ? "กรุณาเข้าสู่ระบบอีกครั้ง" : response.status === 403 || response.status === 404 ? "ไม่มีสิทธิ์ดำเนินการหรือไม่พบข้อมูล" : "ข้อมูลไม่ถูกต้องหรือไม่สามารถบันทึกได้ กรุณาตรวจสอบแล้วลองใหม่");
      error.status = response.status;
      error.details = data;
      throw error;
    }
    return data;
  }
  window.API = {
    request, get user() { return session?.record; }, get token() { return session?.token; },
    async login(identity, password) { const value = await request("/api/collections/users/auth-with-password", { method: "POST", body: { identity, password } }); setSession(value); },
    async refresh() {
      if (!session?.token) return;
      const refreshingSession = session;
      const value = await request("/api/collections/users/auth-refresh", { method: "POST" });
      if (session !== refreshingSession) return;
      if (!value.record.active) { setSession(null); throw new Error("บัญชีนี้ถูกปิดใช้งาน"); }
      setSession(value);
    },
    logout() { setSession(null); },
  };
})();
