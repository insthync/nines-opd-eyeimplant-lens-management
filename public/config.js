window.APP_CONFIG = Object.freeze({
  appName: "OPD Eye Implant & Lens Management",
  appShort: "OPD Eye Implant",
  pocketBaseUrl: window.location.origin,
  pageSize: 10,
});

// Thai labels shared by every view. Keys mirror the collection field values.
window.LABELS = Object.freeze({
  roles: { viewer: "ผู้ชม", editor: "ผู้แก้ไข", admin: "ผู้ดูแล" },
  eye: { od: "ตาขวา (OD)", os: "ตาซ้าย (OS)", ou: "ทั้งสองข้าง (OU)" },
  caseStatus: {
    draft: "ร่าง",
    confirmed: "ยืนยันแล้ว",
    or_verified: "OR Verified",
    completed: "เสร็จสิ้น",
    cancelled: "ยกเลิก",
  },
  resStatus: {
    draft: "ร่าง",
    first_checked: "ตรวจสอบ 1/2 คน",
    verified: "ตรวจสอบครบ 2 คน",
    confirmed: "ยืนยันการจอง",
    used: "ใช้แล้ว",
    cancelled: "ยกเลิก",
  },
  implantType: {
    standard_iol: "IOL มาตรฐาน",
    toric_iol: "Toric IOL",
    multifocal_iol: "Multifocal IOL",
    edof_iol: "EDOF IOL",
    phakic_iol: "Phakic IOL",
    glaucoma_implant: "Glaucoma Implant",
    retinal_implant: "Retinal Implant",
    other: "อื่น ๆ",
  },
  sex: { male: "ชาย", female: "หญิง", other: "อื่น ๆ" },
  priority: { normal: "ปกติ", urgent: "ด่วน" },
  caseScope: { all: "ทุกช่วงเวลา", upcoming: "กำลังจะมาถึง", past: "ที่ผ่านมาแล้ว" },
});
