/* Молодёжка · Темы — единое расписание через textdb.dev */
"use strict";

const STORE_URL = "https://textdb.dev/api/data/sholi-schedule-x9k2";
const LS_CACHE = "sholi_topics_cache";
const LS_NAME = "sholi_user_name";

const TAG_COLORS = {
  "Библия": "#5b4fe9",
  "Игры": "#e07b39",
  "История": "#0e9488",
  "Практика": "#c2410c",
  "Общение": "#be185d",
  "Другое": "#6b7280",
};

let topics = [];
let filterTag = "Все";
let pickedTopic = null;

const $ = (id) => document.getElementById(id);
const TAGS = ["Все", "Библия", "Игры", "История", "Практика", "Общение", "Другое"];

/* ---------- helpers ---------- */

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" });
}

function nextSaturday() {
  const d = new Date();
  const add = (6 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

function saveCache() {
  try { localStorage.setItem(LS_CACHE, JSON.stringify(topics)); } catch (e) {}
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(LS_CACHE) || "[]"); } catch (e) { return []; }
}

function toast(msg, ok) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);
    background:${ok ? "#16a34a" : "#dc2626"};color:#fff;padding:10px 18px;border-radius:12px;
    font-size:14px;font-weight:600;z-index:99;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:88vw;text-align:center`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function tagColor(tag) {
  return TAG_COLORS[tag] || TAG_COLORS["Другое"];
}

/* ---------- data ---------- */

async function fetchTopics() {
  const res = await fetch(STORE_URL + "?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const raw = (await res.text()).trim();
  if (!raw) return [];
  const data = JSON.parse(raw);
  const list = Array.isArray(data) ? data : (data.topics || []);
  return list;
}

async function persist(newTopics) {
  const body = JSON.stringify({ topics: newTopics });
  const res = await fetch(STORE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body,
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

/* конфликт-безопасное изменение: читаем свежие данные, применяем, пишем. Возвращает true/false */
async function applyChange(topicId, mutate) {
  if (applyChange.busy) { toast("Секунду, сохраняется предыдущее изменение…", false); return false; }
  applyChange.busy = true;
  try {
    const fresh = await fetchTopics();
    const idx = fresh.findIndex((t) => t.id === topicId);
    if (idx === -1) { toast("Тема не найдена — обновите страницу", false); return false; }
    const changed = mutate(fresh[idx]);
    if (changed === false) { applyChange.busy = false; return false; }
    fresh[idx] = changed;
    await persist(fresh);
    topics = fresh;
    saveCache();
    render();
    return true;
  } catch (err) {
    console.warn("applyChange failed:", err);
    toast("Не сохранилось. Проверь интернет и попробуй ещё раз 🙏", false);
    return false;
  } finally {
    applyChange.busy = false;
  }
}

async function refresh(silent) {
  const btn = $("refresh-btn");
  btn.classList.add("spin");
  try {
    topics = await fetchTopics();
    if (!Array.isArray(topics)) topics = [];
    saveCache();
    $("offline-bar").classList.add("hidden");
  } catch (e) {
    topics = loadCache();
    if (!silent) $("offline-bar").classList.remove("hidden");
  }
  btn.classList.remove("spin");
  render();
}

/* свободные сверху, внутри — по дате */
function sorted() {
  const list = topics.slice();
  list.sort((a, b) => {
    if (!!a.who !== !!b.who) return a.who ? 1 : -1;
    return (a.date || "9999").localeCompare(b.date || "9999");
  });
  return list;
}

/* ---------- dialog: взять тему ---------- */

function openPick(t, viewMode) {
  pickedTopic = t;
  $("dlg-title").textContent = viewMode ? `«${t.title}»` : `Берёшь «${t.title}»?`;
  $("dlg-sub").textContent = viewMode
    ? "Тему уже заняли. Ниже — кто и когда."
    : "Впиши имя как тебя зовут — его увидят все.";
  $("dlg-name").value = localStorage.getItem(LS_NAME) || "";
  $("dlg-date").value = t.date || nextSaturday();
  const nameRow = $("dlg-name-row");
  if (viewMode) {
    nameRow.classList.add("hidden");
    $("dlg-save").textContent = "Понятно";
    $("dlg-save").dataset.mode = "close";
    $("dlg-date-row").classList.add("hidden");
  } else if (t.who) {
    nameRow.classList.add("hidden");
    $("dlg-save").textContent = "Сохранить дату";
    $("dlg-save").dataset.mode = "date";
    $("dlg-date-row").classList.remove("hidden");
  } else {
    nameRow.classList.remove("hidden");
    $("dlg-save").textContent = "Занять ✋";
    $("dlg-save").dataset.mode = "take";
    $("dlg-date-row").classList.remove("hidden");
  }
  $("pick-dialog").showModal();
}

async function submitPick() {
  const mode = $("dlg-save").dataset.mode || "take";
  const t = pickedTopic;

  if (mode === "close") { $("pick-dialog").close(); return; }

  if (mode === "take") {
    const name = $("dlg-name").value.trim();
    if (!name) { toast("Напиши имя 🙏", false); return; }
    localStorage.setItem(LS_NAME, name);
    const date = $("dlg-date").value;
    $("pick-dialog").close();
    await applyChange(t.id, (tt) => {
      if (tt.who) return false; // уже заняли — не перезаписываем чужое
      return { ...tt, who: name, date };
    });
    toast("Готово! Тема твоя 🙌", true);
    return;
  }

  if (mode === "date") {
    const date = $("dlg-date").value;
    $("pick-dialog").close();
    await applyChange(t.id, (tt) => ({ ...tt, date }));
    toast("Дата обновлена ✅", true);
  }
}

function release(t) {
  const me = localStorage.getItem(LS_NAME) || "";
  if (t.who && t.who !== me && !confirm(`Тему занял ${t.who}. Точно освободить?`)) return;
  applyChange(t.id, (tt) => ({ ...tt, who: null, date: null }));
  toast("Тема снова свободна", true);
}

/* ---------- add topic ---------- */

let addTagSelected = "Другое";

function buildAddTagChips() {
  const wrap = $("add-tag-chips");
  wrap.innerHTML = "";
  TAGS.filter((t) => t !== "Все").forEach((tag) => {
    const c = document.createElement("button");
    c.type = "button";
    c.className = "chip" + (tag === addTagSelected ? " active" : "");
    c.textContent = tag;
    c.onclick = () => { addTagSelected = tag; buildAddTagChips(); };
    wrap.appendChild(c);
  });
}

async function submitAdd(e) {
  e.preventDefault();
  const title = $("add-title").value.trim();
  if (!title) return;
  const note = $("add-note").value.trim();
  const tags = (window.additionalTags && window.additionalTags.length) ? window.additionalTags : [addTagSelected];
  const maxId = topics.reduce((m, t) => Math.max(m, t.id || 0), 0);
  $("add-title").value = "";
  $("add-note").value = "";
  $("add-form").classList.add("hidden");
  applyChange.busy = true;
  try {
    const fresh = await fetchTopics();
    fresh.push({ id: maxId + 1, title, note: note || null, tags, who: null, date: null });
    await persist(fresh);
    topics = fresh;
    saveCache();
    render();
    toast("Тема добавлена ✅", true);
  } catch (err) {
    console.warn("add failed:", err);
    toast("Не удалось добавить — попробуй ещё раз", false);
  } finally {
    applyChange.busy = false;
  }
}

/* ---------- render ---------- */

function chipRow() {
  const wrap = document.createElement("div");
  wrap.className = "chips";
  TAGS.forEach((tag) => {
    const c = document.createElement("button");
    c.className = "chip" + (tag === filterTag ? " active" : "");
    c.textContent = tag;
    c.onclick = () => { filterTag = tag; render(); };
    wrap.appendChild(c);
  });
  return wrap;
}

function render() {
  const host = $("topics");
  host.innerHTML = "";

  const total = topics.length;
  const taken = topics.filter((t) => t.who).length;
  $("stat-text").textContent = `Тем: ${total} · занято: ${taken} · свободно: ${total - taken}`;

  if (total === 0) {
    const e = document.createElement("div");
    e.className = "empty";
    e.innerHTML = "Пока пусто 👋<br>Добавьте первую тему сверху — она появится у всех.";
    host.appendChild(e);
    return;
  }

  host.appendChild(chipRow());

  const list = sorted().filter((t) => filterTag === "Все" || (t.tags || []).includes(filterTag));
  if (list.length === 0) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "В этой категории пока ничего нет";
    host.appendChild(e);
    return;
  }

  list.forEach((t) => {
    const card = document.createElement("div");
    card.className = "topic-card" + (t.who ? " taken" : "");
    if (t.tags && t.tags.length) card.style.borderLeftColor = tagColor(t.tags[0]);

    const head = document.createElement("div");
    head.className = "topic-head";
    const titleWrap = document.createElement("div");
    const h = document.createElement("h3");
    h.className = "topic-title";
    h.textContent = t.title;
    titleWrap.appendChild(h);
    if (t.note) {
      const n = document.createElement("p");
      n.className = "topic-note";
      n.textContent = t.note;
      titleWrap.appendChild(n);
    }
    head.appendChild(titleWrap);

    const badge = document.createElement("span");
    badge.className = "badge " + (t.who ? "taken" : "free");
    badge.textContent = t.who ? "занято" : "свободно";
    head.appendChild(badge);
    card.appendChild(head);

    if (t.who) {
      const w = document.createElement("div");
      w.className = "who-line";
      const b = document.createElement("b");
      b.textContent = t.who;
      w.appendChild(b);
      if (t.date) {
        const when = document.createElement("span");
        when.textContent = " · " + fmtDate(t.date);
        w.appendChild(when);
      }
      card.appendChild(w);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    if (!t.who) {
      const b = document.createElement("button");
      b.className = "btn primary";
      b.textContent = "🙋 Взять тему";
      b.onclick = () => openPick(t);
      actions.appendChild(b);
    } else {
      const me = localStorage.getItem(LS_NAME) || "";
      if (t.who === me) {
        const b1 = document.createElement("button");
        b1.className = "btn ghost";
        b1.textContent = "📅 Изменить дату";
        b1.onclick = () => openPick(t);
        actions.appendChild(b1);
        const b2 = document.createElement("button");
        b2.className = "btn ghost";
        b2.textContent = "Освободить";
        b2.onclick = () => release(t);
        actions.appendChild(b2);
      } else {
        const b = document.createElement("button");
        b.className = "btn ghost";
        b.textContent = "Посмотреть";
        b.onclick = () => openPick(t, true);
        actions.appendChild(b);
      }
    }

    card.appendChild(actions);
    host.appendChild(card);
  });
}

/* ---------- init ---------- */

function init() {
  $("refresh-btn").onclick = () => refresh(false);
  $("add-toggle").onclick = () => {
    $("add-form").classList.toggle("hidden");
    buildAddTagChips();
  };
  $("add-form").onsubmit = submitAdd;
  $("dlg-save").onclick = submitPick;
  $("dlg-cancel").onclick = () => $("pick-dialog").close();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh(true);
  });
  window.addEventListener("online", () => refresh(true));
  window.addEventListener("offline", () => $("offline-bar").classList.remove("hidden"));

  refresh(true);
}

init();