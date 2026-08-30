/* Молодёжка · Темы — UX 2.0: bottom sheets, поиск, фильтры, тёмная тема */
"use strict";

const STORE_URL = "https://textdb.dev/api/data/sholi-schedule-x9k2";
const LS_CACHE = "sholi_topics_cache";
const LS_NAME = "sholi_user_name";
const LS_THEME = "sholi_theme";
const SW_PATH = "./sw.js";

/* [полное название из банка тем, короткая подпись чипа] */
const SECTIONS = [
  ["Я, характер и принятие", "Я и характер"],
  ["Общение, дружба и конфликты", "Общение"],
  ["Бог, вера и сомнения", "Вера"],
  ["Любовь, симпатия и выбор человека", "Любовь"],
  ["Церковь, авторитет и служение", "Церковь"],
  ["Добро, зло, грех и свобода", "Добро и зло"],
  ["Современная жизнь и внутренние решения", "Жизнь и выбор"],
];

const SECTION_COLORS = {
  "Я, характер и принятие": "#5b4fe9",
  "Общение, дружба и конфликты": "#be185d",
  "Бог, вера и сомнения": "#0e9488",
  "Любовь, симпатия и выбор человека": "#e07b39",
  "Церковь, авторитет и служение": "#7c3aed",
  "Добро, зло, грех и свобода": "#c2410c",
  "Современная жизнь и внутренние решения": "#2563eb",
};

let topics = [];
let filterTag = "Все";
let filterStatus = "Все";
let searchQ = "";
let pickedTopic = null;

const $ = (id) => document.getElementById(id);

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
  let host = $("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = "toast" + (ok === true ? " ok" : ok === false ? " err" : "");
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => { t.remove(); }, 2600);
}

function tagColor(tag) {
  return SECTION_COLORS[tag] || "#6b7280";
}

function shortSection(full) {
  const s = SECTIONS.find((x) => x[0] === full);
  return s ? s[1] : (full || "").split(",")[0];
}

/* ---------- data ---------- */

async function fetchTopics() {
  const res = await fetch(STORE_URL + "?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const raw = (await res.text()).trim();
  if (!raw) return [];
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : (data.topics || []);
}

async function persist(newTopics) {
  const res = await fetch(STORE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ topics: newTopics }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

async function applyChange(topicId, mutate) {
  if (applyChange.busy) { toast("Секунду, сохраняется предыдущее…", false); return false; }
  applyChange.busy = true;
  try {
    const fresh = await fetchTopics();
    const idx = fresh.findIndex((t) => t.id === topicId);
    if (idx === -1) { toast("Тема не найдена — обнови", false); return false; }
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
    toast("Не сохранилось. Проверь интернет 🙏", false);
    return false;
  } finally {
    applyChange.busy = false;
  }
}

async function refresh(silent) {
  const btn = $("refresh-btn");
  if (btn) btn.classList.add("spin");
  try {
    topics = await fetchTopics();
    if (!Array.isArray(topics)) topics = [];
    saveCache();
    $("offline-bar").classList.add("hidden");
    $("net-dot").classList.remove("off");
  } catch (e) {
    topics = loadCache();
    $("net-dot").classList.add("off");
    if (!silent) $("offline-bar").classList.remove("hidden");
  }
  if (btn) btn.classList.remove("spin");
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

/* ---------- dialog: взять тему (bottom sheet) ---------- */

function openPick(t, viewMode) {
  pickedTopic = t;
  const title = $("dlg-title");
  const sub = $("dlg-sub");
  const nameRow = $("dlg-name-row");
  const dateRow = $("dlg-date-row");
  const save = $("dlg-save");

  title.textContent = viewMode ? t.title : "Берёшь тему?";
  const theme = t.tags && t.tags.length ? shortSection(t.tags[0]) : "";

  if (viewMode) {
    sub.textContent = "Тему уже заняли — вот кто и когда:";
    nameRow.classList.add("hidden");
    dateRow.classList.add("hidden");
    save.textContent = "Понятно";
    save.dataset.mode = "close";
    let line = $("dlg-view-line");
    if (!line) {
      line = document.createElement("p");
      line.id = "dlg-view-line";
      line.className = "view-line";
      sub.after(line);
    }
    line.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = t.who || "";
    line.appendChild(b);
    if (t.date) line.appendChild(document.createTextNode(" · " + fmtDate(t.date)));
  } else if (t.who) {
    sub.textContent = "Тема занята («" + (t.who || "") + "»). Можешь перенести дату, если это твоё занятие — или закрой лист.";
    nameRow.classList.add("hidden");
    dateRow.classList.remove("hidden");
    save.textContent = "Сохранить дату";
    save.dataset.mode = "date";
  } else {
    if (theme) sub.textContent = "Раздел: " + theme + ". Впиши имя — его увидят все.";
    else sub.textContent = "Впиши имя — его увидят все.";
    nameRow.classList.remove("hidden");
    dateRow.classList.remove("hidden");
    save.textContent = "Занять ✋";
    save.dataset.mode = "take";
  }

  $("dlg-name").value = localStorage.getItem(LS_NAME) || "";
  $("dlg-date").value = t.date || nextSaturday();
  $("pick-sheet").showModal();
}

async function submitPick() {
  const mode = $("dlg-save").dataset.mode || "take";
  const t = pickedTopic;
  const sheet = $("pick-sheet");

  if (mode === "close") { sheet.close(); return; }

  if (mode === "take") {
    const name = $("dlg-name").value.trim();
    if (!name) { toast("Напиши имя 🙏", false); return; }
    localStorage.setItem(LS_NAME, name);
    const date = $("dlg-date").value;
    sheet.close();
    const ok = await applyChange(t.id, (tt) => {
      if (tt.who) return false;
      return { ...tt, who: name, date };
    });
    if (ok) toast("Готово! Тема твоя 🙌", true);
    return;
  }

  if (mode === "date") {
    const date = $("dlg-date").value;
    sheet.close();
    const ok = await applyChange(t.id, (tt) => ({ ...tt, date }));
    if (ok) toast("Дата обновлена ✅", true);
  }
}

function release(t) {
  const me = localStorage.getItem(LS_NAME) || "";
  if (t.who && t.who !== me && !confirm(`Тему занял ${t.who}. Точно освободить?`)) return;
  applyChange(t.id, (tt) => ({ ...tt, who: null, date: null }));
  toast("Тема снова свободна", true);
}

/* ---------- add topic ---------- */

let addTagSelected = SECTIONS[0][0];

function buildAddTagChips() {
  const wrap = $("add-tag-chips");
  wrap.innerHTML = "";
  SECTIONS.forEach(([full, short_]) => {
    const c = document.createElement("button");
    c.type = "button";
    c.className = "chip" + (full === addTagSelected ? " active" : "");
    c.textContent = short_;
    c.onclick = () => { addTagSelected = full; buildAddTagChips(); };
    wrap.appendChild(c);
  });
}

async function submitAdd(e) {
  e.preventDefault();
  const title = $("add-title").value.trim();
  if (!title) return;
  const note = $("add-note").value.trim();
  const maxId = topics.reduce((m, t) => Math.max(m, t.id || 0), 0);
  $("add-title").value = "";
  $("add-note").value = "";
  $("add-sheet").close();
  applyChange.busy = true;
  try {
    const fresh = await fetchTopics();
    fresh.push({ id: maxId + 1, title, note: note || null, tags: [addTagSelected], who: null, date: null, dilemma: null, discuss: null });
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

function filtered() {
  const q = searchQ.trim().toLowerCase();
  return sorted().filter((t) => {
    if (filterStatus === "Свободные" && t.who) return false;
    if (filterStatus === "Занятые" && !t.who) return false;
    if (filterTag !== "Все" && !(t.tags || []).includes(filterTag)) return false;
    if (q) {
      const hay = ((t.title || "") + " " + (t.note || "") + " " + (t.dilemma || "")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function chipRow() {
  const wrap = $("chips");
  wrap.innerHTML = "";
  const all = document.createElement("button");
  all.className = "chip" + (filterTag === "Все" ? " active" : "");
  all.textContent = "Все";
  all.onclick = () => { filterTag = "Все"; render(); wrap.scrollLeft = 0; };
  wrap.appendChild(all);
  SECTIONS.forEach(([full, short_]) => {
    const c = document.createElement("button");
    c.className = "chip" + (filterTag === full ? " active" : "");
    c.textContent = short_;
    c.onclick = () => { filterTag = full; render(); };
    wrap.appendChild(c);
  });
}

function skeletons(n) {
  const host = $("topics");
  host.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const s = document.createElement("div");
    s.className = "skel";
    host.appendChild(s);
  }
}

function render() {
  const host = $("topics");
  host.innerHTML = "";

  const total = topics.length;
  const taken = topics.filter((t) => t.who).length;
  $("stat-total").textContent = total;
  $("stat-taken").textContent = taken;
  $("stat-free").textContent = total - taken;

  if (total === 0) {
    const e = document.createElement("div");
    e.className = "empty";
    e.innerHTML = '<span class="empty-ico">👋</span>Пока пусто — добавьте первую тему (кнопка справа внизу)';
    host.appendChild(e);
    return;
  }

  chipRow();

  const list = filtered();
  if (list.length === 0) {
    const e = document.createElement("div");
    e.className = "empty";
    e.innerHTML = '<span class="empty-ico">🔍</span>Ничего не нашлось — попробуй другой фильтр';
    host.appendChild(e);
    return;
  }

  list.forEach((t, i) => {
    const card = document.createElement("div");
    card.className = "topic-card" + (t.who ? " taken" : "");
    card.style.animationDelay = Math.min(i * 0.03, 0.3) + "s";
    if (t.tags && t.tags.length) card.style.borderLeftColor = tagColor(t.tags[0]);
    else card.style.borderLeftColor = "var(--accent)";

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

    if (t.tags && t.tags.length) {
      const sec = document.createElement("span");
      sec.className = "topic-section";
      sec.textContent = shortSection(t.tags[0]);
      sec.style.background = tagColor(t.tags[0]) + "1a";
      sec.style.color = tagColor(t.tags[0]);
      card.appendChild(sec);
    }

    if (t.dilemma) {
      const d = document.createElement("p");
      d.className = "topic-dilemma";
      const b = document.createElement("b");
      b.textContent = "Дилемма: ";
      d.appendChild(b);
      d.appendChild(document.createTextNode(t.dilemma));
      card.appendChild(d);
    }

    if (t.discuss) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "more-btn";
      more.textContent = "Что обсуждать ▾";
      const details = document.createElement("div");
      details.className = "topic-details";
      const p = document.createElement("p");
      p.textContent = t.discuss;
      details.appendChild(p);
      more.onclick = () => {
        const open = details.classList.toggle("open");
        more.textContent = open ? "Что обсуждать ▴" : "Что обсуждать ▾";
      };
      card.appendChild(more);
      card.appendChild(details);
    }

    if (t.who) {
      const w = document.createElement("div");
      w.className = "who-line";
      const av = document.createElement("span");
      av.className = "avatar";
      av.textContent = "🙋";
      w.appendChild(av);
      const b = document.createElement("b");
      b.textContent = t.who;
      w.appendChild(b);
      if (t.date) {
        const when = document.createElement("span");
        when.textContent = "· " + fmtDate(t.date);
        w.appendChild(when);
      }
      card.appendChild(w);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    if (!t.who) {
      const b = document.createElement("button");
      b.className = "btn primary";
      b.textContent = "Взять тему";
      b.onclick = () => openPick(t);
      actions.appendChild(b);
    } else {
      const me = localStorage.getItem(LS_NAME) || "";
      if (t.who === me) {
        const b1 = document.createElement("button");
        b1.className = "btn ghost";
        b1.textContent = "Изменить дату";
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

/* ---------- theme ---------- */

function applyTheme(mode) {
  document.documentElement.dataset.theme = mode === "dark" ? "dark" : "";
  localStorage.setItem(LS_THEME, mode);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", themeColor());
}

/* ---------- init ---------- */

function init() {
  applyTheme(localStorage.getItem(LS_THEME) || "light");

  $("refresh-btn").onclick = () => refresh(false);
  $("fab").onclick = () => {
    buildAddTagChips();
    $("add-sheet").showModal();
  };
  $("add-form").onsubmit = submitAdd;

  $("seg-status").querySelectorAll(".seg").forEach((b) => {
    b.onclick = () => {
      $("seg-status").querySelectorAll(".seg").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      filterStatus = b.dataset.v;
      render();
    };
  });

  $("search-input").addEventListener("input", (e) => {
    searchQ = e.target.value;
    $("search-clear").classList.toggle("hidden", !searchQ);
    render();
  });
  $("search-clear").onclick = () => {
    $("search-input").value = "";
    searchQ = "";
    $("search-clear").classList.add("hidden");
    render();
  };

  $("dlg-save").onclick = submitPick;
  $("dlg-cancel").onclick = () => $("pick-sheet").close();

  $("theme-btn").onclick = () => {
    const cur = localStorage.getItem(LS_THEME) || "light";
    applyTheme(cur === "dark" ? "light" : "dark");
    $("theme-btn").textContent = cur === "dark" ? "🌙" : "☀️";
  };
  if ((localStorage.getItem(LS_THEME) || "light") === "dark") $("theme-btn").textContent = "☀️";

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh(true);
  });
  window.addEventListener("online", () => refresh(true));
  window.addEventListener("offline", () => $("offline-bar").classList.remove("hidden"));

  skeletons(4);
  refresh(true);
}

init();

/* Service Worker (PWA) */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register(SW_PATH).catch(() => {});
}
