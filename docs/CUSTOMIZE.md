# การใช้เป็นต้นแบบโปรเจค

## สร้าง repository ของแอปใหม่

เมื่ออัปโหลด starter ไป GitHub แล้ว เจ้าของ repository สามารถเปิด Settings → Template repository และใช้ Use this template เพื่อเริ่มแอปใหม่ การตั้งค่านี้ยังไม่ได้ทำให้ในรอบสร้าง local starter

ถ้ายังใช้ local ให้คัดลอกเฉพาะ `public`, `scripts`, `pocketbase/pb_migrations`, `pocketbase/pb_hooks`, `tests`, `docs`, `.gitignore`, `.gitattributes`, `AGENTS.md`, `README.md` แล้วใช้ `git init` ในโฟลเดอร์ใหม่ ห้ามคัดลอกข้อมูล runtime หรือ `.git` ของ starter

## เพิ่มฟิลด์

ตัวอย่างเพิ่ม `category` ให้รายการ:

1. สร้างไฟล์ migration ใหม่ใน `pocketbase/pb_migrations` เช่น `TIMESTAMP_add_category.js` โดยใช้ Unix timestamp จริง
2. ใน up ค้นหา collection `items`, เพิ่ม TextField/SelectField แล้ว `app.save(collection)` ใน down ลบเฉพาะ field นั้น
3. ถ้าฟิลด์ required ต้องออกแบบ default/backfill สำหรับข้อมูลที่มีอยู่ก่อน
4. เพิ่ม input ที่มี `name="category"` ใน `public/index.html`
5. เพิ่มการคืนค่าเข้า form ใน `openItem()` และการแสดงผลใน `render()` ของ `public/app.js` ตรวจ payload ให้ตรง schema
6. ถ้ามีกฎธุรกิจ เพิ่ม hook พร้อม client validation และทดสอบผ่าน API
7. อัปเดต shared asset `?v=` ทุกจุดใน `index.html` และ `register.html` ด้วย Asia/Bangkok `YYYYMMDDHHmm`

การเปลี่ยน `config.js.collection` อย่างเดียวไม่สร้าง collection หรือเปลี่ยน schema ต้องปรับ migration และฟิลด์ให้สัมพันธ์กัน

## เปลี่ยนการมองเห็นข้อมูล

ค่าเริ่มต้นเป็นข้อมูลร่วมกันภายในทีมที่เข้าสู่ระบบ หากต้องการแยกตามเจ้าของหรือองค์กร ให้เพิ่ม relation เช่น `owner`/`organization` แล้วบังคับด้วย API rules พร้อมป้องกันการแก้ owner โดยไม่ได้รับสิทธิ์ และเพิ่ม test ครอบคลุมการอ่าน/เขียนข้ามขอบเขต ห้ามใช้ filter ฝั่งหน้าเว็บเป็นตัวควบคุมสิทธิ์

## เปลี่ยนธีม

ปรับสีและ spacing ใน `public/styles.css` โดยเฉพาะ `:root` แล้วตรวจ login, register, รายการ, ฟอร์ม และ admin ที่ desktop และ 390px ไม่ใช้ CDN หรือ font ภายนอกเป็น dependency
