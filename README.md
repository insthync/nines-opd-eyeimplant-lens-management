# pb-crud-app-starter

ชุดเริ่มต้นเว็บภาษาไทย: HTML/CSS/JavaScript + PocketBase 0.39.8 + SQLite ไม่มี framework หรือขั้นตอน build

มีระบบสมัครสมาชิก เข้าสู่ระบบ สิทธิ์ viewer/editor/admin หน้า admin จัดการสมาชิก และฟอร์มรายการงานที่เพิ่ม ดู แก้ไข ลบ ค้นหา กรองสถานะ และแบ่งหน้าได้

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

## สิทธิ์เริ่มต้น

| ผู้ใช้ | อ่านรายการ | เพิ่ม/แก้ไข/ลบรายการ | จัดการสมาชิก |
| --- | --- | --- | --- |
| ยังไม่เข้าสู่ระบบ | ไม่ได้ | ไม่ได้ | ไม่ได้ |
| viewer | ได้ | ไม่ได้ | ไม่ได้ |
| editor | ได้ | ได้ | ไม่ได้ |
| admin | ได้ | ได้ | เปลี่ยนชื่อ/สิทธิ์/เปิดปิดบัญชีอื่น |

ทุกบัญชีที่ active และเข้าสู่ระบบอ่านรายการทั้งหมดร่วมกันได้ นี่เป็นฐานสำหรับทีมเดียว ยังไม่มี tenant หรือข้อมูลส่วนตัวแยกเจ้าของ ผู้สมัครใหม่เป็น viewer เสมอ การเปลี่ยนสิทธิ์มีผลกับ API ทันที ส่วน UI จะตรวจ session ใหม่เมื่อโหลดรายการ

บัญชี admin ในแอปใช้ collection `users` ไม่มีสิทธิ์ superuser ไม่สามารถแก้ไขตนเอง ลบสมาชิก เปลี่ยนรหัสผ่าน หรือเปลี่ยนอีเมลผ่านหน้า admin นี้ได้ บัญชีแรกและการกู้สิทธิ์จัดการผ่าน setup/PocketBase dashboard

## โครงสร้าง

```text
public/                    ไฟล์ที่ส่งให้ browser เท่านั้น
  index.html               เข้าสู่ระบบ รายการงาน หน้า admin และ dialog
  app.js                   UI, CRUD, ค้นหา และแบ่งหน้า
  api.js                   REST client และ sessionStorage
  config.js                ชื่อแอป URL API ชื่อ collection และขนาดหน้า
  register.html/js          สมัครสมาชิก
  styles.css               หน้าจอ desktop/mobile
pocketbase/pb_migrations/   Schema และ API rules
pocketbase/pb_hooks/        สมัครสมาชิกและตรวจสอบข้อมูลฝั่ง server
scripts/                   ดาวน์โหลด ติดตั้ง เริ่มระบบ (PowerShell/Bash)
tests/integration.mjs       ทดสอบ API บนฐานข้อมูลชั่วคราว
docs/                      วิธีปรับใช้และสถานะส่งต่องาน
```

ให้ PocketBase serve เฉพาะ `public/` ตาม scripts ที่ให้มา ไม่ใช้ repository root เป็น public directory

## นำไปสร้างโปรเจคใหม่

1. ใช้ source repository นี้เป็น GitHub template หรือคัดลอก source ไป repository ใหม่ ดู [CUSTOMIZE.md](docs/CUSTOMIZE.md)
2. เปลี่ยนชื่อแอปใน `public/config.js`, title/brand ใน HTML และเอกสาร
3. เพิ่ม migration สำหรับ schema ที่ต้องการ แล้วปรับฟอร์ม payload และการแสดงผล
4. รัน setup เพื่อสร้างฐานข้อมูลและบัญชีของโปรเจคใหม่

ไม่คัดลอก `pb_data`, `.git`, credentials, exports หรือ backups จากโปรเจคที่มีข้อมูลอยู่แล้ว ตัว binary ไม่ถูกติดตามใน Git และดาวน์โหลดใหม่ได้ ไม่มีข้อมูลคนไข้หรือบัญชีจริงจาก OR Planning Board รวมอยู่ใน starter

## ทดสอบ

ใช้ Node.js 22+ เฉพาะการทดสอบ (การรันแอปไม่ต้องมี Node):

```powershell
node tests/integration.mjs
```

ต้องมี PocketBase binary ก่อน ทดสอบสร้าง database ใน OS temp directory และลบหลังจบ ไม่เปิดฐานข้อมูลจริง `--preview` จะคง test server ไว้พร้อมข้อมูลสมมติและบัญชีรหัสผ่านสุ่มเพื่อทดสอบ browser หยุดด้วย Ctrl+C

ดูขอบเขตสิทธิ์และการใช้งานใน [ARCHITECTURE.md](docs/ARCHITECTURE.md), [SECURITY.md](docs/SECURITY.md) และผลตรวจล่าสุดใน [HANDOFF.md](docs/HANDOFF.md)

Starter รุ่นนี้ใช้ฟอร์มที่กำหนดในโค้ด ยังไม่มี Form Builder, email verification/reset flow, audit log, CI หรือชุด deploy production สำเร็จรูป
