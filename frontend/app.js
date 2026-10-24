// ตัวช่วยเลือก element ในหน้าเว็บ และกล่องแจ้งผลที่ใช้ร่วมกันทุกฟอร์ม
const $ = (selector) => document.querySelector(selector);
const notice = $("#notice");
let token = sessionStorage.getItem("gymToken");
let currentUser = null;
const statusLabels = { ACTIVE: "ใช้งานอยู่", EXPIRED: "หมดอายุ", CANCELLED: "ยกเลิก" };
const statusDescriptions = {
  ACTIVE: "แพ็กเกจกลับมาใช้งานอยู่",
  EXPIRED: "บันทึกว่าแพ็กเกจหมดอายุ",
  CANCELLED: "บันทึกว่ายกเลิกแพ็กเกจ",
};
let memberRows = [];
let membershipRows = [];
let gymRows = [];
let editingGymId = null;
let editingMemberId = null;
let maxFee = "";
let selectedGymId = null;

// แสดงวันที่ในรูปแบบไทย โดยตีความวันที่จากฐานข้อมูลเป็นวันปฏิทิน UTC เพื่อไม่ให้วันเลื่อนตาม timezone
function formatThaiDate(value) {
  const dateOnly = String(value || "").slice(0, 10);
  const date = new Date(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateOnly;
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(date);
}

// กรองข้อมูลบนหน้าปัจจุบัน ไม่ทำ request เพิ่มทุกครั้งที่พิมพ์ค้นหา
function filterVisibleRows() {
  const memberQuery = $("#member-search").value.trim().toLocaleLowerCase("th-TH");
  renderMembers(memberRows.filter((member) =>
    `${member.full_name} ${member.email}`.toLocaleLowerCase("th-TH").includes(memberQuery)));
  const membershipQuery = $("#membership-search").value.trim().toLocaleLowerCase("th-TH");
  const selectedGymId = $("#membership-gym-filter").value;
  renderMemberships(membershipRows.filter((membership) =>
    (!selectedGymId || String(membership.gym_id) === selectedGymId)
    && `${membership.member_name} ${membership.gym_name} ${statusLabels[membership.status] || membership.status}`
      .toLocaleLowerCase("th-TH").includes(membershipQuery)));
}

// ปิดฟอร์มแก้ข้อมูลจนกว่า server จะยืนยัน token; UI เป็นเพียงตัวช่วย ส่วน API ตรวจสิทธิ์ซ้ำ
function showSession() {
  $("#login-form").hidden = Boolean(currentUser);
  $("#session-panel").hidden = !currentUser;
  $("#session-user").textContent = currentUser ? `${currentUser.email} (${currentUser.role})` : "";
  // แสดงเหตุผลของฟอร์มที่ปิดอยู่ ณ จุดใช้งาน ไม่ต้องให้ผู้ใช้เลื่อนกลับไปหา login เอง
  $("#member-locked").hidden = Boolean(currentUser);
  $("#membership-locked").hidden = Boolean(currentUser);
  $("#gym-locked").hidden = Boolean(currentUser);
  for (const form of [$("#member-form"), $("#membership-form")]) {
    for (const control of form.elements) control.disabled = !currentUser;
  }
  for (const control of $("#gym-form").elements) control.disabled = !currentUser;
  document.querySelectorAll("#membership-list select").forEach((control) => { control.disabled = !currentUser; });
  document.querySelectorAll("#membership-list button").forEach((control) => { control.disabled = !currentUser; });
}

// แสดงข้อความสำเร็จหรือข้อผิดพลาดให้ผู้ใช้เห็น โดยไม่ต้องเปลี่ยนหน้า
function message(text, ok = false) {
  notice.textContent = text;
  notice.hidden = false;
  notice.classList.toggle("ok", ok);
}

// ผลของฟอร์มอยู่ใกล้ปุ่มที่ผู้ใช้กดและประกาศผ่าน aria-live
function localMessage(selector, text, ok = false) {
  const target = $(selector);
  target.textContent = text;
  target.hidden = false;
  target.classList.toggle("ok", ok);
}

// การลบทำได้เฉพาะ Admin; ยืนยันผลกระทบก่อนเรียก API และโหลดข้อมูลที่เหลือใหม่
async function deleteRecord(path, label, cascadeNote) {
  const detail = cascadeNote ? `\n\n${cascadeNote}` : "";
  if (!window.confirm(`ยืนยันลบ${label}หรือไม่?${detail}`)) return;
  try {
    await api(path, { method: "DELETE" });
    message(`ลบ${label}แล้ว`, true);
    await load();
  } catch (error) {
    message(`ลบ${label}ไม่สำเร็จ: ${error.message}`);
  }
}

// จุดเดียวสำหรับเรียก API: ส่ง JSON และแปลง network/HTTP error เป็นข้อความอ่านง่าย
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    });
  } catch {
    throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบว่า API ทำงานอยู่");
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/auth/login") {
    token = null; currentUser = null; sessionStorage.removeItem("gymToken"); showSession();
  }
  if (!response.ok) throw new Error(body.message || `API ตอบกลับ ${response.status}`);
  return body;
}

// สร้าง DOM ด้วย textContent เพื่อแสดงข้อมูลจาก API โดยไม่ตีความเป็น HTML
function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

// แสดงสาขาที่ GET /api/gyms ส่งกลับมาในรูปการ์ด
function renderGyms(gyms) {
  const root = $("#gym-list");
  root.replaceChildren();
  // ข้อมูลรายการอาจเปลี่ยนหลังรีเฟรช จึงปิดแผงรายละเอียดที่อ้างถึงรายการเก่า
  selectedGymId = null;
  $("#gym-detail-panel").hidden = true;
  if (!gyms.length) {
    const hasQuery = Boolean($("#gym-search").value.trim());
    const emptyMessage = hasQuery
      ? "ไม่พบสาขาที่ตรงกับคำค้น ลองเปลี่ยนชื่อสาขาหรือที่อยู่"
      : (maxFee !== "" ? "ไม่พบสาขาในช่วงค่าบริการนี้" : "ยังไม่มีข้อมูลสาขา");
    return root.append(el("p", "empty-state", emptyMessage));
  }
  gyms.forEach((gym) => {
    const card = el("article", "gym-card");
    const cardHead = el("div", "gym-card-head");
    // เลขบนการ์ดเป็นลำดับที่แสดง ไม่ใช่รหัสฐานข้อมูลซึ่งต้องคงเดิมและไม่ใช้ซ้ำ
    const sequence = gymRows.findIndex((item) => String(item.id) === String(gym.id)) + 1;
    cardHead.append(el("span", "num", `สาขา ${String(sequence).padStart(2, "0")}`));
    if (currentUser?.role === "admin") {
      const remove = el("button", "row-delete", "ลบสาขา");
      remove.type = "button";
      remove.addEventListener("click", () => deleteRecord(
        `/api/gyms/${gym.id}`, `สาขา ${gym.name}`,
        "การลบสาขาจะลบประวัติการสมัครทั้งหมดที่ผูกกับสาขานี้ด้วย",
      ));
      cardHead.append(remove);
    }
    card.append(cardHead);
    card.append(el("h3", "", gym.name));
    card.append(el("p", "", gym.address));
    const price = el("strong", "", `${Number(gym.monthly_fee).toLocaleString("th-TH")} ฿`);
    price.append(el("small", "", " / เดือน"));
    card.append(price);
    const actions = el("div", "record-actions");
    const detail = el("button", "", "ดูรายละเอียด");
    detail.type = "button";
    detail.setAttribute("aria-controls", "gym-detail-panel");
    detail.setAttribute("aria-expanded", "false");
    detail.addEventListener("click", async () => {
      const panel = $("#gym-detail-panel");
      if (selectedGymId === gym.id && !panel.hidden) {
        panel.hidden = true;
        selectedGymId = null;
        detail.setAttribute("aria-expanded", "false");
        return;
      }
      selectedGymId = gym.id;
      panel.hidden = false;
      panel.classList.remove("error");
      $("#gym-detail-title").textContent = `รายละเอียด ${gym.name}`;
      $("#gym-detail-fields").textContent = "กำลังโหลดรายละเอียดสาขา...";
      root.querySelectorAll('[aria-controls="gym-detail-panel"]').forEach((button) => button.setAttribute("aria-expanded", String(button === detail)));
      detail.disabled = true;
      try {
        // อ่าน GET ตาม ID แล้ววางผลใต้ปุ่มของสาขานั้น ผู้ใช้จึงเห็นผลทันทีโดยไม่ต้องเลื่อนไปหา notice
        const result = await api(`/api/gyms/${gym.id}`);
        if (selectedGymId !== gym.id) return;
        const fields = [
          ["รหัสสาขา", `#${result.data.id}`], ["ที่อยู่", result.data.address],
          ["โทรศัพท์", result.data.phone_number],
          ["ค่าบริการ", `${Number(result.data.monthly_fee).toLocaleString("th-TH")} บาท/เดือน`],
        ];
        const list = $("#gym-detail-fields");
        list.replaceChildren();
        for (const [label, value] of fields) {
          const field = el("div");
          field.append(el("dt", "", label), el("dd", "", value || "—"));
          list.append(field);
        }
        if (selectedGymId === gym.id) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (error) {
        if (selectedGymId !== gym.id) return;
        $("#gym-detail-fields").textContent = `โหลดรายละเอียดไม่สำเร็จ: ${error.message}`;
        panel.classList.add("error");
      } finally { detail.disabled = false; }
    });
    const memberships = el("button", "", "การสมัครของสาขา");
    memberships.type = "button";
    memberships.addEventListener("click", () => {
      // เลือกสาขาในตัวกรองเดียวกับตาราง แล้วเลื่อนไปยังจุดที่เห็นผลการกรองทันที
      $("#membership-gym-filter").value = String(gym.id);
      $("#membership-search").value = "";
      filterVisibleRows();
      $("#memberships").scrollIntoView({ behavior: "smooth", block: "start" });
      $("#membership-gym-filter").focus({ preventScroll: true });
    });
    actions.append(detail, memberships);
    if (currentUser) {
      const edit = el("button", "", "แก้ไขสาขา");
      edit.type = "button";
      edit.addEventListener("click", () => editGym(gym.id));
      actions.append(edit);
    }
    card.append(actions);
    root.append(card);
  });
}

// กรองการ์ดจากข้อมูลที่โหลดไว้ จึงค้นหาได้ทันทีโดยไม่ยิง request ทุกครั้งที่พิมพ์
function filterVisibleGyms() {
  const query = $("#gym-search").value.trim().toLocaleLowerCase("th-TH");
  const visibleGyms = gymRows.filter((gym) =>
    `${gym.name} ${gym.address}`.toLocaleLowerCase("th-TH").includes(query));
  renderGyms(visibleGyms);
  const count = $("#gym-count");
  if (count) count.textContent = query ? `พบ ${visibleGyms.length} จาก ${gymRows.length} สาขา` : `${gymRows.length} สาขา`;
}

$("#gym-detail-close").addEventListener("click", () => {
  $("#gym-detail-panel").hidden = true;
  selectedGymId = null;
  document.querySelectorAll('#gym-list [aria-controls="gym-detail-panel"]').forEach((button) => button.setAttribute("aria-expanded", "false"));
});

// แสดงรายชื่อสมาชิกที่ GET /api/members ส่งกลับมา
function renderMembers(members) {
  const root = $("#member-list");
  root.replaceChildren();
  if (!members.length) return root.append(el("p", "", $("#member-search").value ? "ไม่พบสมาชิกที่ค้นหา" : "ยังไม่มีข้อมูลสมาชิก"));
  for (const member of members) {
    // แต่ละรายการมีแผงรายละเอียดของตัวเอง ผลจาก GET ตาม ID จึงอยู่ใกล้ปุ่มที่กด
    const item = el("div", "member-item");
    const row = el("div", "member-row");
    row.append(el("span", "initial", (member.full_name || "?").charAt(0).toUpperCase()));
    const main = el("div", "member-main");
    main.append(el("strong", "", member.full_name));
    main.append(el("small", "", member.email));
    row.append(main);
    // รวมรหัสและปุ่มของสมาชิกไว้กลุ่มเดียว เพื่อไม่ให้ปุ่มแยกห่างกันบนจอมือถือ
    const controls = el("div", "member-controls");
    controls.append(el("small", "member-id", `#${member.id}`));
    const detail = el("button", "record-link", "ดูข้อมูล");
    detail.type = "button";
    const panel = el("div", "member-detail-panel");
    panel.id = `member-detail-${member.id}`;
    panel.hidden = true;
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", `รายละเอียดสมาชิก ${member.full_name}`);
    detail.setAttribute("aria-controls", panel.id);
    detail.setAttribute("aria-expanded", "false");
    detail.addEventListener("click", async () => {
      if (!panel.hidden) {
        panel.hidden = true;
        detail.textContent = "ดูข้อมูล";
        detail.setAttribute("aria-expanded", "false");
        return;
      }
      panel.hidden = false;
      panel.textContent = "กำลังโหลดข้อมูลสมาชิก...";
      detail.disabled = true;
      detail.setAttribute("aria-expanded", "true");
      try {
        const result = await api(`/api/members/${member.id}`);
        const fields = [
          ["ชื่อ–นามสกุล", result.data.full_name], ["อีเมล", result.data.email],
          ["เบอร์โทรศัพท์", result.data.phone_number], ["วันที่สมัคร", formatThaiDate(result.data.join_date)],
        ];
        const list = el("dl", "member-detail-grid");
        for (const [label, value] of fields) {
          const field = el("div");
          field.append(el("dt", "", label), el("dd", "", value || "—"));
          list.append(field);
        }
        panel.replaceChildren(list);
        detail.textContent = "ซ่อนข้อมูล";
      } catch (error) {
        panel.textContent = `โหลดข้อมูลไม่สำเร็จ: ${error.message}`;
        panel.classList.add("error");
      } finally { detail.disabled = false; }
    });
    controls.append(detail);
    if (currentUser) {
      const edit = el("button", "record-link", "แก้ไข");
      edit.type = "button";
      edit.addEventListener("click", () => editMember(member.id));
      controls.append(edit);
    }
    if (currentUser?.role === "admin") {
      const remove = el("button", "row-delete", "ลบ");
      remove.type = "button";
      remove.setAttribute("aria-label", `ลบสมาชิก ${member.full_name}`);
      remove.addEventListener("click", () => deleteRecord(
        `/api/members/${member.id}`, `สมาชิก ${member.full_name}`,
        "ประวัติการสมัครทั้งหมดของสมาชิกคนนี้จะถูกลบด้วย",
      ));
      controls.append(remove);
    }
    row.append(controls);
    item.append(row, panel);
    root.append(item);
  }
}

// เติมตัวเลือกสมาชิก/สาขาจากข้อมูลล่าสุด โดยรักษาค่าที่เลือกไว้เมื่อรีเฟรช
function fillChoices(name, items, label) {
  const select = document.querySelector(`#membership-form [name="${name}"]`);
  const previous = select.value;
  select.replaceChildren(el("option", "", label));
  select.firstChild.value = "";
  for (const item of items) {
    const option = el("option", "", item.label);
    option.value = item.id;
    select.append(option);
  }
  select.value = previous;
}

// แก้ไขจากข้อมูล GET ตาม ID เพื่อไม่ใช้ค่าที่อาจเก่าจากรายการบนหน้า
async function editGym(id) {
  try {
    const { data } = await api(`/api/gyms/${id}`);
    editingGymId = id;
    $("#gym-entry").open = true;
    const form = $("#gym-form");
    for (const key of ["name", "address", "monthly_fee", "phone_number"]) form.elements[key].value = data[key] ?? "";
    $("#gym-form-title").textContent = `แก้ไขสาขา ${data.name}`;
    $("#gym-cancel").hidden = false;
    $("#gym-entry").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) { localMessage("#gym-feedback", error.message); }
}

async function editMember(id) {
  try {
    const { data } = await api(`/api/members/${id}`);
    editingMemberId = id;
    const form = $("#member-form");
    for (const key of ["full_name", "email", "phone_number"]) form.elements[key].value = data[key] ?? "";
    form.elements.join_date.value = String(data.join_date).slice(0, 10);
    $("#member-form-title").textContent = `แก้ไขสมาชิก ${data.full_name}`;
    $("#member-cancel").hidden = false;
    $("#member-entry").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) { localMessage("#member-feedback", error.message); }
}

function resetGymForm() {
  editingGymId = null;
  $("#gym-form").reset();
  $("#gym-form-title").textContent = "เพิ่มสาขา";
  $("#gym-cancel").hidden = true;
  $("#gym-entry").open = false;
}

function resetMemberForm() {
  editingMemberId = null;
  $("#member-form").reset();
  $("#member-form-title").textContent = "ลงทะเบียนสมาชิก";
  $("#member-cancel").hidden = true;
}

// แสดงประวัติการสมัคร พร้อมขั้นยืนยันก่อน PUT เพื่อกันการเลือกสถานะพลาด
function renderMemberships(memberships) {
  const root = $("#membership-list");
  root.replaceChildren();
  if (!memberships.length) {
    const row = el("tr");
    const hasFilter = $("#membership-search").value || $("#membership-gym-filter").value;
    const cell = el("td", "", hasFilter ? "ไม่พบรายการสมัครที่ตรงกับตัวกรอง" : "ยังไม่มีข้อมูลการสมัคร");
    cell.colSpan = 5;
    row.append(cell);
    return root.append(row);
  }
  for (const membership of memberships) {
    const row = el("tr");
    row.append(el("td", "", membership.member_name || `#${membership.member_id}`));
    row.append(el("td", "", membership.gym_name || `#${membership.gym_id}`));
    row.append(el("td", "", `${formatThaiDate(membership.start_date)} ถึง ${formatThaiDate(membership.end_date)}`));
    const status = el("td");
    const badge = el("span", `badge ${membership.status}`, statusLabels[membership.status] || membership.status);
    status.append(badge);
    row.append(status);
    const action = el("td");
    const controls = el("div", "status-actions");
    const select = el("select");
    select.setAttribute("aria-label", `สถานะของ ${membership.member_name || membership.member_id}`);
    for (const value of ["ACTIVE", "EXPIRED", "CANCELLED"]) {
      const option = el("option", "", statusLabels[value]);
      option.value = value;
      select.append(option);
    }
    select.value = membership.status;
    select.disabled = !currentUser;
    const save = el("button", "save", "บันทึก");
    save.type = "button";
    save.hidden = true;
    const cancel = el("button", "", "ยกเลิก");
    cancel.type = "button";
    cancel.hidden = true;
    const undo = el("button", "undo", "คืนค่าเดิม");
    undo.type = "button";
    undo.hidden = true;
    const feedback = el("small", "row-feedback");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    // เลือกค่าใหม่ยังไม่บันทึกจนกดปุ่ม; ยกเลิกจะคืนค่าที่เก็บใน MySQL ล่าสุด
    select.addEventListener("change", () => {
      save.hidden = select.value === membership.status;
      cancel.hidden = save.hidden;
      undo.hidden = true;
      feedback.textContent = "";
      if (!save.hidden) feedback.textContent = statusDescriptions[select.value];
    });
    cancel.addEventListener("click", () => {
      select.value = membership.status;
      save.hidden = true;
      cancel.hidden = true;
      undo.hidden = true;
      feedback.textContent = "ไม่ได้เปลี่ยนสถานะ";
    });
    // บันทึกหรือคืนสถานะผ่าน route เดียวกัน เพื่อให้ผู้ใช้แก้การกดผิดได้ทันที
    async function writeStatus(nextStatus, successText) {
      select.disabled = true; save.disabled = true; cancel.disabled = true; undo.disabled = true;
      try {
        const result = await api(`/api/memberships/${membership.id}/status`, {
          method: "PUT",
          body: JSON.stringify({ status: nextStatus }),
        });
        // ใช้ค่าที่ API ยืนยัน แล้วเก็บสถานะก่อนหน้าไว้ให้กดย้อนคืนได้
        membership.status = result.data.status;
        badge.className = `badge ${membership.status}`;
        badge.textContent = statusLabels[membership.status] || membership.status;
        select.value = membership.status;
        save.hidden = true; cancel.hidden = true;
        undo.hidden = membership.status === originalStatus;
        feedback.classList.remove("error");
        feedback.textContent = successText;
      } catch (error) {
        feedback.classList.add("error");
        feedback.textContent = `บันทึกไม่สำเร็จ: ${error.message} ลองอีกครั้งหรือยกเลิกได้`;
      } finally {
        select.disabled = !currentUser; save.disabled = !currentUser;
        cancel.disabled = !currentUser; undo.disabled = !currentUser;
      }
    }
    const originalStatus = membership.status;
    save.addEventListener("click", () => writeStatus(select.value, `บันทึกสถานะ${statusLabels[select.value]}แล้ว`));
    undo.addEventListener("click", () => writeStatus(originalStatus, `คืนค่าสถานะเป็น${statusLabels[originalStatus]}แล้ว`));
    controls.append(select, save, cancel, undo);
    action.append(controls, feedback);
    row.append(action);
    root.append(row);
  }
}

// โหลด 3 resource พร้อมกัน แล้วอัปเดตรายการและตัวเลือกในฟอร์ม
async function load() {
  $("#summary").textContent = "กำลังโหลด...";
  try {
    const [gyms, members, memberships] = await Promise.all([
      api(maxFee === "" ? "/api/gyms" : `/api/gyms?max_fee=${encodeURIComponent(maxFee)}`), api("/api/members"), api("/api/memberships"),
    ]);
    // ตัวกรองราคาเปลี่ยนเฉพาะการ์ด; ตัวเลือกสมัครแพ็กเกจต้องยังเห็นทุกสาขา
    const allGyms = maxFee === "" ? gyms : await api("/api/gyms");
    memberRows = members.data;
    membershipRows = memberships.data;
    gymRows = gyms.data;
    filterVisibleGyms();
    fillChoices("gym_id", allGyms.data.map((gym) => ({ id: gym.id, label: gym.name })), "เลือกสาขา");
    fillChoices("member_id", members.data.map((member) => ({ id: member.id, label: member.full_name })), "เลือกสมาชิก");
    const gymFilter = $("#membership-gym-filter");
    const selectedGymId = gymFilter.value;
    gymFilter.replaceChildren(el("option", "", "ทุกสาขา"));
    gymFilter.firstChild.value = "";
    for (const gym of allGyms.data) {
      const option = el("option", "", gym.name);
      option.value = gym.id;
      gymFilter.append(option);
    }
    gymFilter.value = selectedGymId;
    filterVisibleRows();
    $("#summary").textContent = `${gyms.data.length} สาขา · ${members.data.length} สมาชิก${maxFee === "" ? "" : " (กรองราคา)"}`;
  } catch (error) {
    message(error.message);
    $("#summary").textContent = "โหลดข้อมูลไม่ได้";
    for (const selector of ["#gym-list", "#member-list"]) $(selector).textContent = "โหลดข้อมูลไม่ได้";
    $("#membership-list").textContent = "";
  }
}

// Login สำเร็จแล้วจึงเก็บ token ใน sessionStorage ของแท็บนี้และเปิดฟอร์ม
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  try {
    const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify(values) });
    token = result.token; currentUser = result.user; sessionStorage.setItem("gymToken", token);
    form.reset(); showSession(); message("เข้าสู่ระบบสำเร็จ", true); await load();
    $("#member-entry").scrollIntoView({ behavior: "smooth", block: "center" });
    $("#member-form [name=full_name]").focus({ preventScroll: true });
  } catch (error) { message(error.message); }
});

$("#logout").addEventListener("click", () => {
  token = null; currentUser = null; sessionStorage.removeItem("gymToken"); resetGymForm(); resetMemberForm(); showSession(); message("ออกจากระบบแล้ว", true); load();
});

// POST และ PUT ใช้ฟอร์มเดียวกัน แต่ส่งชนิดตัวเลขตาม schema ของ API
$("#gym-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form));
  values.monthly_fee = Number(values.monthly_fee);
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await api(editingGymId ? `/api/gyms/${editingGymId}` : "/api/gyms", {
      method: editingGymId ? "PUT" : "POST", body: JSON.stringify(values),
    });
    message(editingGymId ? "แก้ไขสาขาสำเร็จ" : "เพิ่มสาขาสำเร็จ", true);
    resetGymForm();
    await load();
  } catch (error) { localMessage("#gym-feedback", error.message); }
  finally { button.disabled = false; }
});
$("#gym-cancel").addEventListener("click", resetGymForm);
$("#member-cancel").addEventListener("click", resetMemberForm);

// External API อาจใช้ fallback; แสดงที่มาและข้อความที่ backend ส่งกลับอย่างตรงไปตรงมา
$("#weather-reload").addEventListener("click", async () => {
  const target = $("#weather-result");
  const lat = $("#weather-lat");
  const lon = $("#weather-lon");
  if (!lat.reportValidity() || !lon.reportValidity()) return;
  target.textContent = "กำลังโหลดสภาพอากาศ...";
  try {
    const { data } = await api(`/api/weather?lat=${encodeURIComponent(lat.value)}&lon=${encodeURIComponent(lon.value)}`);
    const weather = data.weather;
    target.textContent = weather.available
      ? `อุณหภูมิ ${weather.temperature}°C · ลม ${weather.windspeed} กม./ชม. · Open-Meteo`
      : weather.note || "บริการสภาพอากาศยังไม่พร้อม";
  } catch (error) { target.textContent = error.message; }
});

// รีเฟรชหน้าแล้วยังคง session เฉพาะเมื่อ API ยอมรับ token เดิม
async function restoreSession() {
  if (token) {
    try { currentUser = (await api("/api/auth/me")).user; }
    catch { token = null; sessionStorage.removeItem("gymToken"); }
  }
  showSession();
}

// ตรวจข้อมูลในเบราว์เซอร์ก่อน POST /api/members แล้วโหลดรายการใหม่
$("#member-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const button = form.querySelector("button");
  const values = Object.fromEntries(new FormData(form));
  button.disabled = true;
  try {
    const wasEditing = Boolean(editingMemberId);
    const result = await api(wasEditing ? `/api/members/${editingMemberId}` : "/api/members", {
      method: wasEditing ? "PUT" : "POST", body: JSON.stringify(values),
    });
    resetMemberForm();
    localMessage("#member-feedback", wasEditing ? "แก้ไขสมาชิกสำเร็จ" : "เพิ่มสมาชิกสำเร็จ", true);
    await load();
    // หลังเพิ่มใหม่ พาไปสมัครแพ็กเกจ; การแก้ไขเดิมให้คงตำแหน่งฟอร์มไว้
    if (!wasEditing) {
      $("#membership-form [name=member_id]").value = result.data.id;
      $("#membership-form [name=gym_id]").focus({ preventScroll: true });
      $("#memberships").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    localMessage("#member-feedback", error.message);
  } finally {
    button.disabled = false;
  }
});

// ปุ่มรีเฟรชใช้ขั้นตอนโหลดเดียวกับการเปิดหน้าเว็บครั้งแรก
$("#reload").addEventListener("click", load);
// ค่ากรองส่งไปยัง GET /api/gyms?max_fee ตาม OpenAPI; ล้างค่าแล้วโหลดทั้งหมดกลับมา
$("#apply-fee").addEventListener("click", () => {
  if (!$("#max-fee").reportValidity()) return;
  maxFee = $("#max-fee").value;
  load();
});
$("#clear-fee").addEventListener("click", () => { $("#max-fee").value = ""; maxFee = ""; load(); });
$("#gym-search").addEventListener("input", filterVisibleGyms);
$("#member-search").addEventListener("input", filterVisibleRows);
$("#membership-search").addEventListener("input", filterVisibleRows);
$("#membership-gym-filter").addEventListener("change", filterVisibleRows);

// สร้างแพ็กเกจสมาชิก: ตรวจช่วงวันก่อน POST /api/memberships
$("#membership-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form));
  if (values.end_date < values.start_date) return localMessage("#membership-feedback", "วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น");
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    await api("/api/memberships", { method: "POST", body: JSON.stringify(values) });
    form.reset();
    localMessage("#membership-feedback", "สมัครแพ็กเกจสำเร็จ", true);
    await load();
  } catch (error) {
    localMessage("#membership-feedback", error.message);
  } finally {
    button.disabled = false;
  }
});
// เริ่มดึงข้อมูลทันทีเมื่อสคริปต์โหลดเสร็จ (script ใช้ defer)
const sectionNavLinks = [...document.querySelectorAll('.topbar nav a[href^="#"]')];
const sectionNavTargets = sectionNavLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

if ("IntersectionObserver" in window && sectionNavTargets.length) {
  const visibleSections = new Set();
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) visibleSections.add(entry.target);
      else visibleSections.delete(entry.target);
    });

    const currentSection = [...visibleSections].sort((a, b) =>
      Math.abs(a.getBoundingClientRect().top - 100) - Math.abs(b.getBoundingClientRect().top - 100),
    )[0];

    sectionNavLinks.forEach((link) => {
      if (currentSection && link.hash === `#${currentSection.id}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }, { rootMargin: "-12% 0px -72% 0px" });

  sectionNavTargets.forEach((section) => sectionObserver.observe(section));
}

restoreSession().then(load);
