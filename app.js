"use strict";

const STORE_URL = "https://textdb.dev/api/data/sholi-schedule-x9k2";
const LS_CACHE = "sholi_topics_cache";
const LS_NAME = "sholi_user_name";
const LS_THEME = "sholi_theme";
const SECTIONS = [
  ["Я, характер и принятие", "Я и характер"],
  ["Общение, дружба и конфликты", "Общение"],
  ["Бог, вера и сомнения", "Вера"],
  ["Любовь, симпатия и выбор человека", "Любовь"],
  ["Церковь, авторитет и служение", "Церковь"],
  ["Добро, зло, грех и свобода", "Добро и зло"],
  ["Современная жизнь и внутренние решения", "Жизнь и выбор"],
];

const state = {
  topics: [],
  status: "all",
  category: "all",
  query: "",
  openId: null,
  busy: false,
  addCategory: SECTIONS[0][0],
  scheduleMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedScheduleDate: null,
};

const $ = (id) => document.getElementById(id);
const els = {};

function escapeText(value) {
  return String(value ?? "");
}

function sectionShort(name) {
  return SECTIONS.find(([full]) => full === name)?.[1] || name || "Без раздела";
}

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function dateToISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromISO(iso) {
  const [year, month, day] = String(iso || "").split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function isSunday(iso) {
  const date = dateFromISO(iso);
  return !Number.isNaN(date.getTime()) && date.getDay() === 0;
}

function firstUpcomingSunday() {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7));
  return date;
}

function sundayDates(count = 12) {
  const dates = [];
  const date = firstUpcomingSunday();
  for (let index = 0; index < count; index += 1) {
    dates.push(dateToISO(date));
    date.setDate(date.getDate() + 7);
  }
  return dates;
}

function topicOnDate(topics, date, exceptId = null) {
  return topics.find((topic) => topic.who && topic.date === date && String(topic.id) !== String(exceptId));
}

function nextAvailableSunday(topics, exceptId = null) {
  return sundayDates(52).find((date) => !topicOnDate(topics, date, exceptId)) || dateToISO(firstUpcomingSunday());
}

function saveCache() {
  try { localStorage.setItem(LS_CACHE, JSON.stringify(state.topics)); } catch (_) {}
}

function loadCache() {
  try {
    const value = JSON.parse(localStorage.getItem(LS_CACHE) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (_) { return []; }
}

function toast(message, error = false) {
  const node = document.createElement("div");
  node.className = `toast${error ? " error" : ""}`;
  node.textContent = message;
  els.toastHost.appendChild(node);
  window.setTimeout(() => node.remove(), 2600);
}

function setSync(label, loading = false) {
  els.syncState.textContent = label;
  els.refreshBtn.classList.toggle("loading", loading);
}

async function fetchTopics() {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(`${STORE_URL}?t=${Date.now()}`, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = (await response.text()).trim();
    if (!text) return [];
    const data = JSON.parse(text);
    const topics = Array.isArray(data) ? data : data.topics;
    return Array.isArray(topics) ? topics : [];
  } finally {
    window.clearTimeout(timer);
  }
}

async function persist(topics) {
  const response = await fetch(STORE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ topics }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function refresh({ quiet = false } = {}) {
  if (!quiet) setSync("Обновление…", true);
  try {
    state.topics = await fetchTopics();
    saveCache();
    els.offlineNote.classList.add("hidden");
    setSync("Синхронизировано", false);
  } catch (error) {
    state.topics = loadCache();
    els.offlineNote.classList.remove("hidden");
    setSync("Не в сети", false);
  }
  render();
}

async function mutateTopic(id, mutate) {
  if (state.busy) return false;
  state.busy = true;
  render();
  try {
    const fresh = await fetchTopics();
    const index = fresh.findIndex((topic) => String(topic.id) === String(id));
    if (index < 0) throw new Error("missing");
    const changed = mutate({ ...fresh[index] }, fresh);
    if (changed?.error) {
      toast(changed.error, true);
      state.topics = fresh;
      return false;
    }
    if (!changed) {
      toast("Эту тему уже заняли. Список обновлён.", true);
      state.topics = fresh;
      return false;
    }
    fresh[index] = changed;
    await persist(fresh);
    state.topics = fresh;
    saveCache();
    setSync("Синхронизировано");
    return true;
  } catch (error) {
    toast("Не сохранилось. Проверь интернет.", true);
    return false;
  } finally {
    state.busy = false;
    render();
  }
}

function sortedFilteredTopics() {
  const query = state.query.trim().toLocaleLowerCase("ru");
  return [...state.topics]
    .filter((topic) => {
      if (state.status === "free" && topic.who) return false;
      if (state.status === "taken" && !topic.who) return false;
      if (state.category !== "all" && !(topic.tags || []).includes(state.category)) return false;
      if (!query) return true;
      const haystack = [topic.title, topic.note, topic.dilemma, topic.discuss, topic.who].filter(Boolean).join(" ").toLocaleLowerCase("ru");
      return haystack.includes(query);
    })
    .sort((a, b) => {
      if (Boolean(a.who) !== Boolean(b.who)) return a.who ? 1 : -1;
      if (a.who && b.who) return (a.date || "9999").localeCompare(b.date || "9999");
      return Number(a.id) - Number(b.id);
    });
}

function renderSummary() {
  const total = state.topics.length;
  const free = state.topics.filter((topic) => !topic.who).length;
  els.summary.textContent = total ? `${free} свободно из ${total}` : "Пока нет тем";
}

function openSchedule(date = null) {
  const selected = date || dateToISO(firstUpcomingSunday());
  const parsed = dateFromISO(selected);
  state.selectedScheduleDate = selected;
  state.scheduleMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  renderCalendar();
  if (!els.scheduleDialog.open) els.scheduleDialog.showModal();
}

function renderSundayStrip() {
  els.sundayStrip.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const date of sundayDates(4)) {
    const scheduled = topicOnDate(state.topics, date);
    const parsed = dateFromISO(date);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sunday-card${scheduled ? " taken" : ""}`;
    button.setAttribute("aria-label", `${formatDate(date)} — ${scheduled ? `${scheduled.who}, ${scheduled.title}` : "свободно"}`);

    const dateLine = document.createElement("span");
    dateLine.className = "sunday-date";
    const day = document.createElement("strong");
    day.textContent = String(parsed.getDate());
    const month = document.createElement("span");
    month.textContent = parsed.toLocaleDateString("ru-RU", { month: "short" }).replace(".", "");
    dateLine.append(day, month);

    const person = document.createElement("span");
    person.className = "sunday-person";
    person.textContent = scheduled ? scheduled.who : "Свободно";
    button.append(dateLine, person);
    button.addEventListener("click", () => openSchedule(date));
    fragment.appendChild(button);
  }
  els.sundayStrip.appendChild(fragment);
}

function renderCalendarDetail(date) {
  const scheduled = topicOnDate(state.topics, date);
  els.calendarDetail.replaceChildren();
  els.calendarDetail.classList.toggle("free", !scheduled);
  const time = document.createElement("time");
  time.dateTime = date;
  time.textContent = dateFromISO(date).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const title = document.createElement("strong");
  title.textContent = scheduled ? scheduled.who : "Свободное воскресенье";
  els.calendarDetail.append(time, title);
  if (scheduled) {
    const topic = document.createElement("p");
    topic.textContent = scheduled.title;
    els.calendarDetail.appendChild(topic);
  }
}

function renderCalendar() {
  if (!els.calendarGrid) return;
  const year = state.scheduleMonth.getFullYear();
  const month = state.scheduleMonth.getMonth();
  els.monthTitle.textContent = state.scheduleMonth.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  els.calendarGrid.replaceChildren();

  const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  for (let index = 0; index < firstOffset; index += 1) {
    const blank = document.createElement("span");
    blank.className = "calendar-day";
    els.calendarGrid.appendChild(blank);
  }

  let firstSunday = null;
  for (let day = 1; day <= days; day += 1) {
    const parsed = new Date(year, month, day, 12);
    const date = dateToISO(parsed);
    const sunday = parsed.getDay() === 0;
    const scheduled = sunday ? topicOnDate(state.topics, date) : null;
    const cell = document.createElement(sunday ? "button" : "span");
    if (sunday) {
      cell.type = "button";
      firstSunday ||= date;
    }
    cell.className = `calendar-day${sunday ? " sunday" : ""}${scheduled ? " taken" : ""}${state.selectedScheduleDate === date ? " selected" : ""}${date === dateToISO(new Date()) ? " today" : ""}`;
    cell.textContent = String(day);
    if (sunday) {
      cell.setAttribute("aria-label", `${formatDate(date)} — ${scheduled ? `занято, ${scheduled.who}` : "свободно"}`);
      cell.addEventListener("click", () => {
        state.selectedScheduleDate = date;
        renderCalendar();
      });
    }
    els.calendarGrid.appendChild(cell);
  }

  const selectedIsVisible = state.selectedScheduleDate && dateFromISO(state.selectedScheduleDate).getMonth() === month && dateFromISO(state.selectedScheduleDate).getFullYear() === year;
  if (!selectedIsVisible) state.selectedScheduleDate = firstSunday;
  if (state.selectedScheduleDate) {
    const selectedCell = [...els.calendarGrid.querySelectorAll(".sunday")].find((cell) => cell.textContent === String(dateFromISO(state.selectedScheduleDate).getDate()));
    selectedCell?.classList.add("selected");
    renderCalendarDetail(state.selectedScheduleDate);
  }
}

function renderCategories() {
  els.categoryFilter.replaceChildren();
  const options = [["all", "Все разделы"], ...SECTIONS];
  for (const [value, label] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-chip${state.category === value ? " active" : ""}`;
    button.textContent = label;
    button.setAttribute("aria-pressed", String(state.category === value));
    button.addEventListener("click", () => {
      state.category = value;
      state.openId = null;
      render();
    });
    els.categoryFilter.appendChild(button);
  }
}

function paragraph(className, label, text) {
  const p = document.createElement("p");
  p.className = className;
  if (label) {
    const strong = document.createElement("strong");
    strong.textContent = label;
    p.append(strong, document.createTextNode(" "));
  }
  p.append(document.createTextNode(escapeText(text)));
  return p;
}

function makeField(label, type, value, name) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const caption = document.createElement("span");
  caption.textContent = label;
  const input = document.createElement("input");
  input.type = type;
  input.value = value || "";
  input.name = name;
  if (type === "text") {
    input.maxLength = 40;
    input.autocomplete = "name";
  } else if (type === "date") {
    input.required = true;
    input.min = dateToISO(new Date());
  }
  wrap.append(caption, input);
  return { wrap, input };
}

function validateScheduleDate(date, topicId) {
  if (!date) {
    toast("Выбери воскресенье.", true);
    return false;
  }
  if (!isSunday(date)) {
    toast("Для встречи нужно выбрать воскресенье.", true);
    return false;
  }
  const conflict = topicOnDate(state.topics, date, topicId);
  if (conflict) {
    toast(`${formatDate(date)} уже занято: ${conflict.who}.`, true);
    return false;
  }
  return true;
}

function makeButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${className}`;
  button.textContent = label;
  button.disabled = state.busy;
  button.addEventListener("click", handler);
  return button;
}

function buildTopicPanel(topic) {
  const panel = document.createElement("div");
  panel.className = "topic-panel";
  if (topic.dilemma) panel.appendChild(paragraph("detail", "Вопрос:", topic.dilemma));
  if (topic.discuss) panel.appendChild(paragraph("detail", "Обсудить:", topic.discuss));
  if (topic.note) panel.appendChild(paragraph("detail", "", topic.note));

  if (topic.who) {
    const claimed = document.createElement("div");
    claimed.className = "claimed-by";
    const strong = document.createElement("strong");
    strong.textContent = escapeText(topic.who);
    claimed.append(strong);
    if (topic.date) claimed.append(document.createTextNode(` · ${formatDate(topic.date)}`));
    panel.appendChild(claimed);
  }

  const form = document.createElement("div");
  form.className = "inline-form";
  const savedName = localStorage.getItem(LS_NAME) || "";

  if (!topic.who) {
    const name = makeField("Имя", "text", savedName, "name");
    const date = makeField("Воскресенье", "date", topic.date || nextAvailableSunday(state.topics, topic.id), "date");
    const actions = document.createElement("div");
    actions.className = "inline-actions";
    actions.appendChild(makeButton("Взять тему", "primary", async () => {
      const who = name.input.value.trim();
      if (!who) { toast("Напиши имя.", true); name.input.focus(); return; }
      const selectedDate = date.input.value;
      if (!validateScheduleDate(selectedDate, topic.id)) { date.input.focus(); return; }
      localStorage.setItem(LS_NAME, who);
      const ok = await mutateTopic(topic.id, (fresh, topics) => {
        if (fresh.who) return null;
        const conflict = topicOnDate(topics, selectedDate, topic.id);
        if (conflict) return { error: `${formatDate(selectedDate)} уже занято: ${conflict.who}.` };
        return { ...fresh, who, date: selectedDate };
      });
      if (ok) toast("Тема твоя.");
    }));
    form.append(name.wrap, date.wrap, actions);
  } else {
    const date = makeField("Воскресенье", "date", topic.date || nextAvailableSunday(state.topics, topic.id), "date");
    const spacer = document.createElement("div");
    const actions = document.createElement("div");
    actions.className = "inline-actions";
    actions.append(
      makeButton("Сохранить", "secondary", async () => {
        const selectedDate = date.input.value;
        if (!validateScheduleDate(selectedDate, topic.id)) { date.input.focus(); return; }
        const ok = await mutateTopic(topic.id, (fresh, topics) => {
          const conflict = topicOnDate(topics, selectedDate, topic.id);
          if (conflict) return { error: `${formatDate(selectedDate)} уже занято: ${conflict.who}.` };
          return { ...fresh, date: selectedDate };
        });
        if (ok) toast("Дата обновлена.");
      }),
      makeButton("Освободить", "danger", async () => {
        if (topic.who !== savedName && !window.confirm(`Тему занял ${topic.who}. Освободить?`)) return;
        const ok = await mutateTopic(topic.id, (fresh) => ({ ...fresh, who: null, date: null }));
        if (ok) toast("Тема свободна.");
      })
    );
    form.append(spacer, date.wrap, actions);
  }

  panel.appendChild(form);
  return panel;
}

function buildTopic(topic) {
  const article = document.createElement("article");
  const isOpen = String(state.openId) === String(topic.id);
  article.className = `topic-item${isOpen ? " open" : ""}`;
  const main = document.createElement("button");
  main.type = "button";
  main.className = "topic-main";
  main.setAttribute("aria-expanded", String(isOpen));

  const copy = document.createElement("span");
  copy.className = "topic-copy";
  const title = document.createElement("span");
  title.className = "topic-title";
  title.textContent = escapeText(topic.title);
  const meta = document.createElement("span");
  meta.className = "topic-meta";
  const category = document.createElement("span");
  category.className = "category-name";
  category.textContent = sectionShort(topic.tags?.[0]);
  meta.appendChild(category);
  if (topic.who) {
    meta.append(document.createTextNode("·"));
    const who = document.createElement("span");
    who.textContent = topic.date ? `${topic.who}, ${formatDate(topic.date)}` : topic.who;
    meta.appendChild(who);
  }
  copy.append(title, meta);

  const side = document.createElement("span");
  side.className = "topic-side";
  const status = document.createElement("span");
  status.className = `status${topic.who ? " taken" : ""}`;
  status.textContent = topic.who ? "Занято" : "Свободно";
  const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.setAttribute("viewBox", "0 0 24 24");
  chevron.setAttribute("aria-hidden", "true");
  chevron.classList.add("chevron");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m7 10 5 5 5-5");
  chevron.appendChild(path);
  side.append(status, chevron);
  main.append(copy, side);
  main.addEventListener("click", () => {
    state.openId = isOpen ? null : topic.id;
    renderTopics();
    if (!isOpen) requestAnimationFrame(() => article.querySelector('input[type="text"]')?.focus({ preventScroll: true }));
  });
  article.append(main);
  if (isOpen) article.appendChild(buildTopicPanel(topic));
  return article;
}

function renderTopics() {
  const list = sortedFilteredTopics();
  els.topicList.replaceChildren();
  els.topicList.setAttribute("aria-busy", "false");
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.topics.length ? "Ничего не найдено." : "Список пока пуст.";
    els.topicList.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  list.forEach((topic) => fragment.appendChild(buildTopic(topic)));
  els.topicList.appendChild(fragment);
}

function render() {
  renderSummary();
  renderSundayStrip();
  renderCategories();
  els.statusFilter.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.status === state.status));
  renderTopics();
  if (els.scheduleDialog.open) renderCalendar();
}

function renderSkeletons() {
  els.topicList.replaceChildren();
  for (let i = 0; i < 6; i += 1) {
    const skeleton = document.createElement("div");
    skeleton.className = "skeleton";
    els.topicList.appendChild(skeleton);
  }
}

function renderAddCategories() {
  els.addCategories.replaceChildren();
  SECTIONS.forEach(([full, short]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-option${state.addCategory === full ? " active" : ""}`;
    button.textContent = short;
    button.addEventListener("click", () => { state.addCategory = full; renderAddCategories(); });
    els.addCategories.appendChild(button);
  });
}

async function addTopic(event) {
  event.preventDefault();
  if (state.busy) return;
  const title = els.addTitle.value.trim();
  const note = els.addNote.value.trim();
  if (!title) return;
  state.busy = true;
  try {
    const fresh = await fetchTopics();
    const ids = fresh.map((topic) => Number(topic.id)).filter(Number.isFinite);
    fresh.push({
      id: (ids.length ? Math.max(...ids) : 0) + 1,
      title,
      note: note || null,
      tags: [state.addCategory],
      who: null,
      date: null,
      dilemma: null,
      discuss: null,
    });
    await persist(fresh);
    state.topics = fresh;
    saveCache();
    els.addDialog.close();
    els.addForm.reset();
    render();
    toast("Тема добавлена.");
  } catch (error) {
    toast("Не удалось сохранить.", true);
  } finally {
    state.busy = false;
  }
}

function applyTheme(theme) {
  const value = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = value === "dark" ? "dark" : "";
  localStorage.setItem(LS_THEME, value);
  document.querySelector('meta[name="theme-color"]').content = value === "dark" ? "#171816" : "#f7f7f5";
}

function bind() {
  Object.assign(els, {
    summary: $("summary"),
    syncState: $("sync-state"),
    refreshBtn: $("refresh-btn"),
    themeBtn: $("theme-btn"),
    addBtn: $("add-btn"),
    searchInput: $("search-input"),
    searchClear: $("search-clear"),
    statusFilter: $("status-filter"),
    categoryFilter: $("category-filter"),
    offlineNote: $("offline-note"),
    topicList: $("topic-list"),
    addDialog: $("add-dialog"),
    addForm: $("add-form"),
    addTitle: $("add-title"),
    addNote: $("add-note"),
    addCategories: $("add-categories"),
    scheduleBtn: $("schedule-btn"),
    calendarLink: $("calendar-link"),
    sundayStrip: $("sunday-strip"),
    scheduleDialog: $("schedule-dialog"),
    monthTitle: $("month-title"),
    calendarGrid: $("calendar-grid"),
    calendarDetail: $("calendar-detail"),
    toastHost: $("toast-host"),
  });

  els.refreshBtn.addEventListener("click", () => refresh());
  els.themeBtn.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value;
    state.openId = null;
    els.searchClear.classList.toggle("hidden", !state.query);
    renderTopics();
  });
  els.searchClear.addEventListener("click", () => {
    els.searchInput.value = "";
    state.query = "";
    state.openId = null;
    els.searchClear.classList.add("hidden");
    renderTopics();
    els.searchInput.focus();
  });
  els.statusFilter.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-status]");
    if (!button) return;
    state.status = button.dataset.status;
    state.openId = null;
    render();
  });
  els.addBtn.addEventListener("click", () => {
    renderAddCategories();
    els.addDialog.showModal();
  });
  $("add-close").addEventListener("click", () => els.addDialog.close());
  $("add-cancel").addEventListener("click", () => els.addDialog.close());
  els.addForm.addEventListener("submit", addTopic);
  els.addDialog.addEventListener("click", (event) => {
    if (event.target === els.addDialog) els.addDialog.close();
  });
  els.scheduleBtn.addEventListener("click", () => openSchedule());
  els.calendarLink.addEventListener("click", () => openSchedule());
  $("schedule-close").addEventListener("click", () => els.scheduleDialog.close());
  $("month-prev").addEventListener("click", () => {
    state.scheduleMonth = new Date(state.scheduleMonth.getFullYear(), state.scheduleMonth.getMonth() - 1, 1);
    state.selectedScheduleDate = null;
    renderCalendar();
  });
  $("month-next").addEventListener("click", () => {
    state.scheduleMonth = new Date(state.scheduleMonth.getFullYear(), state.scheduleMonth.getMonth() + 1, 1);
    state.selectedScheduleDate = null;
    renderCalendar();
  });
  els.scheduleDialog.addEventListener("click", (event) => {
    if (event.target === els.scheduleDialog) els.scheduleDialog.close();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh({ quiet: true }); });
  window.addEventListener("online", () => refresh({ quiet: true }));
  window.addEventListener("offline", () => els.offlineNote.classList.remove("hidden"));
}

function init() {
  const preferred = localStorage.getItem(LS_THEME) || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(preferred);
  bind();
  renderSkeletons();
  refresh().catch(() => {
    state.topics = loadCache();
    render();
  });
}

try {
  init();
} catch (error) {
  document.body.textContent = "Не удалось открыть список. Обнови страницу.";
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
