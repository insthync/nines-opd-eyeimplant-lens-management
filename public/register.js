document.querySelector("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#register-error");
  const button = form.querySelector("button[type=submit]");
  const body = Object.fromEntries(new FormData(form));
  error.textContent = "";
  if (!body.name.trim()) { error.textContent = "กรุณาระบุชื่อที่แสดง"; return; }
  if (body.password !== body.passwordConfirm) { error.textContent = "รหัสผ่านทั้งสองช่องไม่ตรงกัน"; return; }
  button.disabled = true;
  try {
    await API.request("/api/starter/register", { method: "POST", body });
    form.reset(); form.hidden = true;
    document.querySelector("#register-success").hidden = false;
  } catch (err) { error.textContent = err.status === 400 ? "สร้างบัญชีไม่ได้ อีเมลอาจถูกใช้แล้ว หรือข้อมูลไม่ถูกต้อง" : err.message; }
  finally { button.disabled = false; }
});
