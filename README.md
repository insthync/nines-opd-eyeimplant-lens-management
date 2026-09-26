# OPD Eye Implant & Lens Management

ระบบบริหาร Implant และ Lens คลินิกจักษุ (ภาษาไทย): HTML/CSS/JavaScript + PocketBase 0.39.8 + SQLite ไม่มี framework หรือขั้นตอน build

ครอบคลุม workflow ตั้งแต่ ผู้ป่วย → Case ผ่าตัด → การจอง Implant → ตรวจสอบ 2 คน (Two-Person Verification) → ยืนยัน Case พร้อม Reserve Stock → Surgery Readiness → OR Verified → บันทึกใช้จริงและตัด Stock → Traceability/Recall โดยมี Dashboard แสดงสิ่งที่ต้องดำเนินการ (ตัดหน้า Purchase/PO Tracking และ Reports ออกตามขอบเขต)

มีระบบสมัครสมาชิก เข้าสู่ระบบ สิทธิ์ viewer/editor/admin และหน้า admin จัดการสมาชิกครบถ้วน

## เริ่มใช้งานบน Windows

เปิด PowerShell ในโฟลเดอร์โปรเจค:

```powershell
./scripts/setup-pocketbase.ps1
./scripts/start-pocketbase.ps1
```

Setup จะถามอีเมล/รหัสผ่านสองบัญชี: PocketBase superuser สำหรับดูแลระบบ และบัญชีแอปเริ่มต้นที่มี role admin รหัสผ่านไม่ถูกบันทึกในไฟล์โปรเจค

- แอป: http://127.0.0.1:8090/
- PocketBase dashboard: http://127.0.0.1:8090/_/
- หยุดเซิร์ฟเวอร์ด้วย Ctrl+C

Setup ดาวน์โหลด binary ที่ pin version ไว้ หากมี version ตรงกันอยู่แล้วจะใช้ไฟล์เดิม การรัน setup ซ้ำด้วยอีเมลเดิมจะอัปเดตบัญชีและรหัสผ่านนั้น

## Linux / macOS

ต้องมี Bash, curl, unzip และเครื่องมือระบบพื้นฐาน จากนั้นรัน:

```bash
bash scripts/setup-pocketbase.sh
bash scripts/start-pocketbase.sh
```

อ่าน options ด้วย `bash scripts/setup-pocketbase.sh --help` หรือ `Get-Help ./scripts/setup-pocketbase.ps1` บน Windows ตัวแปร `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD`, `PB_STAFF_EMAIL`, `PB_STAFF_PASSWORD`, `PB_STAFF_NAME`, `PB_STAFF_ROLE` ใช้กับ setup ได้ ห้าม commit ค่า credentials

## โมดูลในแอป

| เมนู | ความสามารถ |
| --- | --- |
| แดชบอร์ด | KPI วันนี้/เดือนนี้ (Case, พร้อม, รอ, มีปัญหา, Implant ที่ใช้, มูลค่า) และ Exception Center (Case ใกล้ผ่าตัดที่ยังไม่พร้อม, Low/Out of stock, ใกล้/หมดอายุ) กดเปิดได้ |
| ตารางผ่าตัด | สร้าง/แก้ไข Case (เลข Case อัตโนมัติ EYE-YYYYMM-NNNN, เลือกตาจาก dropdown เท่านั้น, สร้างผู้ป่วยใหม่ในฟอร์มได้), กรองช่วงเวลา/สถานะ/ตา, ค้นหา HN/ชื่อ/เลข Case, ปุ่มดำเนินการตามสถานะ, readiness ต่อ Case |
| การจอง Implant | เลขจองอัตโนมัติ RES-YYYYMM-NNNN, ตรวจสอบ 2 คน (ห้ามคนเดียวกัน), ยืนยันด้วย FINAL IMPLANT SAFETY CHECK 12 ข้อ + เลือก Lot พร้อมยอดคงเหลือ, บันทึกใช้จริง, ยกเลิกพร้อมคืน Stock |
| คลัง & Stock | รับเข้า (รวม Lot เดิมอัตโนมัติ), แก้ไข Lot, สถานะ 🟢/🟡 OUT/LOW เทียบ Min stock, วันหมดอายุ 🟢/🟡/🔴 |
| การใช้งาน & Traceability | ประวัติการใช้ทุกครั้ง, ค้นตามผู้ป่วย (HN/ชื่อ) → Implant ที่เคยได้รับ, ค้นตาม Lot/Serial → ผู้ป่วยทั้งหมดที่ได้รับ (Recall) |
| ข้อมูลหลัก | ผู้ป่วย (HN ไม่ซ้ำ), Implant Master (Product Code ไม่ซ้ำ, ประเภท/Power/Cylinder/ราคา/Min-Max stock), ร้านค้า, แพทย์, หัตถการ |
| จัดการสมาชิก (admin) | เปลี่ยนชื่อ/สิทธิ์/เปิดปิดบัญชีอื่น |

ทุกการเปลี่ยนสถานะ (ตรวจสอบ, ยืนยัน, OR Verified, ใช้จริง, ยกเลิก, รับเข้า) ทำผ่าน server routes ที่บังคับกฎความปลอดภัย: ห้ามข้ามขั้นตอน, ห้ามใช้ Lot หมดอายุ, ห้าม Reserve เกิน Stock, แก้ไขข้อมูลสำคัญหลังยืนยันไม่ได้ และบันทึก audit log (`case_logs`) ทุกครั้ง

## สิทธิ์เริ่มต้น

| ผู้ใช้ | อ่านข้อมูล | เพิ่ม/แก้ไข/ดำเนินการ | จัดการสมาชิก |
| --- | --- | --- | --- |
| ยังไม่เข้าสู่ระบบ | ไม่ได้ | ไม่ได้ | ไม่ได้ |
| viewer | ได้ (รวมประวัติการใช้/Traceability) | ไม่ได้ | ไม่ได้ |
| editor | ได้ | ได้ (ทุก workflow) | ไม่ได้ |
| admin | ได้ | ได้ + ลบ Case/Lot | เปลี่ยนชื่อ/สิทธิ์/เปิดปิดบัญชีอื่น |

ข้อมูลใช้ร่วมกันทั้งทีม (single-team) ยังไม่มี tenant/เจ้าของแยก ผู้สมัครใหม่เป็น viewer เสมอ บัญชี admin ในแอปไม่มีสิทธิ์ superuser แก้ตนเองไม่ได้ การกู้สิทธิ์จัดการผ่าน setup/PocketBase dashboard

## โครงสร้าง

```text
public/                    ไฟล์ที่ส่งให้ browser เท่านั้น
  index.html               เข้าสู่ระบบ + ทุกโมดูล (sidebar) + dialog ของ workflow
  app.js                   session, นำทาง และแดชบอร์ด
  cases.js                 ตารางผ่าตัดและฟอร์ม Case
  reservations.js          การจอง ตรวจสอบ 2 คน ยืนยัน ใช้จริง ยกเลิก
  inventory.js             คลัง Stock รับเข้า แก้ไข Lot
  usage.js                 ประวัติการใช้ + Traceability/Recall
  masters.js               ข้อมูลหลัก 5 หมวด
  members.js               หน้า admin จัดการสมาชิก
  ui.js                    helper ใช้ร่วม (list controller, dialog builder)
  api.js                   REST client + workflow routes + sessionStorage
  config.js                ชื่อแอป URL API ขนาดหน้า และป้ายภาษาไทย
  register.html/js          สมัครสมาชิก
  styles.css               ธีมน้ำเงินคลินิก desktop/mobile
pocketbase/pb_migrations/   Schema และ API rules (starter + ระบบ implant)
pocketbase/pb_hooks/        workflow routes, validation, สมัครสมาชิก
scripts/                   ดาวน์โหลด ติดตั้ง เริ่มระบบ (PowerShell/Bash)
tests/integration.mjs       ทดสอบ API/workflow บนฐานข้อมูลชั่วคราว
docs/                      สถาปัตยกรรม ความปลอดภัย และสถานะส่งต่องาน
```

ให้ PocketBase serve เฉพาะ `public/` ตาม scripts ที่ให้มา ไม่ใช้ repository root เป็น public directory

## ทดสอบ

ใช้ Node.js 22+ เฉพาะการทดสอบ (การรันแอปไม่ต้องมี Node):

```powershell
node tests/integration.mjs
```

ต้องมี PocketBase binary ก่อน ทดสอบสร้าง database ใน OS temp directory และลบหลังจบ ไม่เปิดฐานข้อมูลจริง ชุดทดสอบครอบคลุม 135 รายการ: สิทธิ์ทุก collection, workflow ครบวงจร, กันการข้ามขั้นตอน, ห้ามใช้ Lot หมดอายุ, คืน Stock เมื่อยกเลิก, Traceability 2 ทาง และ private-path

`--preview` จะคง test server ไว้พร้อมข้อมูลสมมติ (ผู้ป่วย 12, Implant 9, Case 7 สถานะครบทุกขั้น, stock รวม Lot หมดอายุ) และบัญชีรหัสผ่านสุ่มเพื่อทดลองใน browser หยุดด้วย Ctrl+C

```powershell
node tests/integration.mjs --preview
```

ดูรายละเอียด schema/rules/routes ใน [ARCHITECTURE.md](docs/ARCHITECTURE.md), ขอบเขตความปลอดภัยใน [SECURITY.md](docs/SECURITY.md), คู่มือระบบฉบับเต็ม (data model, workflow, คู่มือใช้งานทุกโมดูล, API, แก้ปัญหา) ใน [SYSTEM.md](docs/SYSTEM.md) และผลตรวจล่าสุดใน [HANDOFF.md](docs/HANDOFF.md)

ยังไม่มี: หน้า Purchase/PO Tracking, Reports/PDF, Google Drive, email verification/reset, CI หรือชุด deploy production (ดูขอบเขตใน HANDOFF.md)
