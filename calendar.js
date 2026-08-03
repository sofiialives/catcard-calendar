/* ==========================================================================
   calendar.js — вся логика календаря публикаций.
   Работает только с config.js (данные JSONBin) — без сервера и без БД.
   ========================================================================== */

(function () {
  "use strict";

  const cfg = window.CALENDAR_CONFIG;
  const AUTH_KEY = "kometa_calendar_auth_" + cfg.clientSlug;

  const RU_MONTHS = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
  ];
  const RU_WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  const STATUS_LABELS = { draft: "Черновик", scheduled: "Запланирован", published: "Опубликован" };

  const COSMIC_PALETTE = [
    "#22D3EE", "#4ADE80", "#A78BFA", "#6366F1",
    "#F472B6", "#FBBF24", "#2DD4BF", "#FB7185",
  ];

  const DEFAULT_RUBRICS = [
    { id: "r1", name: "Вопрос-ответ", color: "#22D3EE" },
    { id: "r2", name: "Ошибки", color: "#4ADE80" },
    { id: "r3", name: "Кейс", color: "#A78BFA" },
    { id: "r4", name: "Направления расчетов", color: "#6366F1" },
  ];

  // ---- state ----
  let posts = [];
  let rubrics = [];
  let viewYear, viewMonth; // viewMonth: 0-11
  let isCopywriter = false;
  let pendingCellDate = null; // date string used when creating a new post
  let editingPostId = null;
  let selectedTypeId = null;
  let selectedStatus = "draft";
  let selectedSwatch = COSMIC_PALETTE[0];

  const todayObj = new Date();
  const todayStr = fmtDate(todayObj);

  const isConfigured =
    cfg.jsonbinBinId && !cfg.jsonbinBinId.startsWith("ВСТАВЬТЕ") &&
    cfg.jsonbinMasterKey && !cfg.jsonbinMasterKey.startsWith("ВСТАВЬТЕ");

  // ==========================================================================
  // Utilities
  // ==========================================================================
  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function isPastDate(dateStr) {
    return dateStr < todayStr;
  }

  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function uid() {
    return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }
  function pluralPosts(n) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return n + " пост";
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return n + " поста";
    return n + " постов";
  }
  function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }
  function isWeekend(d) {
    const wd = d.getDay();
    return wd === 0 || wd === 6;
  }

  // Демо-посты — показываются только пока JSONBin не настроен (см. isConfigured)
  function buildDemoPosts() {
    const mk = (offsetDays, title, time, typeId, status, description) => ({
      id: uid(),
      title, time, typeId, status, description,
      date: fmtDate(addDays(todayObj, offsetDays)),
    });
    return [
      mk(-14, "Как работает выпуск карты", "10:00", "r1", "published", "Разбор самого частого вопроса от новых пользователей."),
      mk(-9, "Задержка пополнения — что делать", "14:00", "r2", "published", "Пошаговая инструкция на случай задержки платежа."),
      mk(-5, "Кейс: перевод в Китай без проблем", "16:30", "r3", "published", "Реальный пример использования карты клиентом."),
      mk(-2, "Сравнение направлений: Европа vs Азия", "11:00", "r4", "published", "Обзор комиссий и лимитов по регионам."),
      mk(1, "Новый пост о лимитах", "09:30", "r1", "scheduled", "Черновой план публикации."),
      mk(4, "Черновик: обновление тарифов", "13:00", "r2", "draft", "Пока не готово к публикации."),
    ];
  }

  // ==========================================================================
  // Data layer (JSONBin) — swap this block if you ever move to a real backend
  // ==========================================================================
  const JSONBIN_BASE = "https://api.jsonbin.io/v3/b/" + (cfg.jsonbinBinId || "");
  const LOCAL_KEY = "kometa_calendar_demo_" + cfg.clientSlug;

  async function loadAll() {
    if (!isConfigured) {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        try { return JSON.parse(raw); } catch (e) { /* reseed below */ }
      }
      const seeded = { posts: buildDemoPosts(), rubrics: DEFAULT_RUBRICS };
      localStorage.setItem(LOCAL_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const res = await fetch(JSONBIN_BASE + "/latest", {
      method: "GET",
      headers: { "X-Bin-Meta": "false" },
    });
    if (!res.ok) throw new Error("Не удалось загрузить календарь (" + res.status + ")");
    const data = await res.json();
    return {
      posts: Array.isArray(data.posts) ? data.posts : [],
      rubrics: Array.isArray(data.rubrics) && data.rubrics.length ? data.rubrics : DEFAULT_RUBRICS,
    };
  }

  async function saveAll(data) {
    if (!isConfigured) {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      return;
    }
    const res = await fetch(JSONBIN_BASE, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": cfg.jsonbinMasterKey,
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Не удалось сохранить (" + res.status + ")");
  }

  // ==========================================================================
  // Auth
  // ==========================================================================
  function checkStoredAuth() {
    isCopywriter = localStorage.getItem(AUTH_KEY) === "1";
    reflectAuthUI();
  }

  async function tryLogin(password) {
    const hash = await sha256Hex(password);
    if (hash === cfg.copywriterPasswordHash) {
      localStorage.setItem(AUTH_KEY, "1");
      isCopywriter = true;
      reflectAuthUI();
      return true;
    }
    return false;
  }

  function logout() {
    localStorage.removeItem(AUTH_KEY);
    isCopywriter = false;
    reflectAuthUI();
  }

  function reflectAuthUI() {
    document.body.classList.toggle("is-copywriter", isCopywriter);
    const btn = document.getElementById("authButton");
    if (btn) {
      btn.querySelector(".auth-btn__label").textContent = isCopywriter
        ? "Режим копирайтера · выйти"
        : "Войти как копирайтер";
      btn.classList.toggle("auth-btn--active", isCopywriter);
    }
    render();
  }

  // ==========================================================================
  // Calendar rendering
  // ==========================================================================
  // ==========================================================================
  // Rubrics
  // ==========================================================================
  function rubricById(id) {
    return rubrics.find((r) => r.id === id) || null;
  }

  function renderLegend() {
    const legend = document.getElementById("calLegend");
    legend.innerHTML = "";
    rubrics.forEach((r) => {
      const el = document.createElement("span");
      el.className = "cal-legend__item";
      el.innerHTML =
        '<span class="cal-legend__dot" style="background:' + r.color + ";box-shadow:0 0 6px " + r.color + '"></span>' +
        escapeHtml(r.name);
      legend.appendChild(el);
    });
  }

  function renderRubricsModalList() {
    const list = document.getElementById("rubricsList");
    list.innerHTML = "";
    rubrics.forEach((r) => {
      const item = document.createElement("div");
      item.className = "rubric-row";
      const delBtn = isCopywriter
        ? '<button type="button" class="rubric-row__del" data-id="' + r.id + '" title="Удалить рубрику">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M18 6L6 18M6 6l12 12"/></svg></button>'
        : "";
      item.innerHTML =
        '<span class="rubric-row__dot" style="background:' + r.color + ";box-shadow:0 0 6px " + r.color + '"></span>' +
        '<span class="rubric-row__name">' + escapeHtml(r.name) + "</span>" + delBtn;
      list.appendChild(item);
    });
    list.querySelectorAll(".rubric-row__del").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const r = rubricById(id);
        const usedCount = posts.filter((p) => p.typeId === id).length;
        const warn = usedCount > 0 ? " Она используется в " + pluralPosts(usedCount) + " — они останутся без рубрики." : "";
        askConfirm('Удалить рубрику «' + (r ? r.name : "") + '»?' + warn, () => doDeleteRubric(id));
      });
    });
  }

  async function doDeleteRubric(id) {
    setBusy(true);
    try {
      const updatedRubrics = rubrics.filter((r) => r.id !== id);
      await saveAll({ posts, rubrics: updatedRubrics });
      rubrics = updatedRubrics;
      renderLegend();
      renderRubricsModalList();
      render();
    } catch (err) {
      alert("Ошибка: " + err.message);
    } finally {
      setBusy(false);
    }
  }

  function renderSwatches() {
    const wrap = document.getElementById("rubricColorSwatches");
    wrap.innerHTML = "";
    COSMIC_PALETTE.forEach((color) => {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "swatch";
      sw.style.background = color;
      sw.style.boxShadow = "0 0 8px " + color;
      if (color === selectedSwatch) sw.classList.add("swatch--active");
      sw.addEventListener("click", () => {
        selectedSwatch = color;
        renderSwatches();
      });
      wrap.appendChild(sw);
    });

    // Custom color — opens the native OS color picker for any color, not just presets
    const isCustom = !COSMIC_PALETTE.includes(selectedSwatch);
    const customBtn = document.createElement("button");
    customBtn.type = "button";
    customBtn.className = "swatch swatch--custom";
    customBtn.title = "Свой цвет";
    customBtn.style.background = isCustom
      ? selectedSwatch
      : "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)";
    if (isCustom) customBtn.classList.add("swatch--active");
    customBtn.addEventListener("click", () => {
      document.getElementById("rubricCustomColorInput").click();
    });
    wrap.appendChild(customBtn);
  }

  function initRubricsModal() {
    document.getElementById("rubricsButton").addEventListener("click", () => {
      renderRubricsModalList();
      selectedSwatch = COSMIC_PALETTE[0];
      renderSwatches();
      document.getElementById("rubricNameInput").value = "";
      document.getElementById("rubricAddError").hidden = true;
      openModal("rubricsModal");
    });
    document.getElementById("rubricsModalClose").addEventListener("click", () => closeModal("rubricsModal"));
    document.getElementById("rubricsModal").addEventListener("click", (e) => {
      if (e.target.id === "rubricsModal") closeModal("rubricsModal");
    });
    document.getElementById("rubricCustomColorInput").addEventListener("input", (e) => {
      selectedSwatch = e.target.value;
      renderSwatches();
    });

    document.getElementById("rubricAddBtn").addEventListener("click", async () => {
      const name = document.getElementById("rubricNameInput").value.trim();
      const errEl = document.getElementById("rubricAddError");
      if (!name) {
        errEl.textContent = "Введите название рубрики.";
        errEl.hidden = false;
        return;
      }
      errEl.hidden = true;
      setBusy(true);
      try {
        const newRubric = { id: uid(), name, color: selectedSwatch };
        const updatedRubrics = [...rubrics, newRubric];
        await saveAll({ posts, rubrics: updatedRubrics });
        rubrics = updatedRubrics;
        renderLegend();
        renderRubricsModalList();
        document.getElementById("rubricNameInput").value = "";
      } catch (err) {
        errEl.textContent = "Ошибка сохранения: " + err.message;
        errEl.hidden = false;
      } finally {
        setBusy(false);
      }
    });
  }

  function postsForDate(dateStr) {
    return posts
      .filter((p) => p.date === dateStr)
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  function render() {
    document.getElementById("calMonthLabel").textContent =
      RU_MONTHS[viewMonth] + " " + viewYear;

    const countInMonth = posts.filter((p) => {
      const [y, m] = p.date.split("-").map(Number);
      return y === viewYear && m === viewMonth + 1;
    }).length;
    document.getElementById("calMonthCount").textContent =
      countInMonth === 0 ? "нет постов" : pluralPosts(countInMonth);

    const grid = document.getElementById("calGrid");
    grid.innerHTML = "";

    // weekday header row
    RU_WEEKDAYS.forEach((w, i) => {
      const el = document.createElement("div");
      el.className = "cal-weekday" + (i >= 5 ? " cal-weekday--weekend" : "");
      el.textContent = w;
      grid.appendChild(el);
    });

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    // JS getDay(): 0=Sun..6=Sat -> convert to Mon-start index 0..6
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startOffset + 1;
      let cellDate, inMonth;

      if (dayNum < 1) {
        cellDate = new Date(viewYear, viewMonth - 1, daysInPrevMonth + dayNum);
        inMonth = false;
      } else if (dayNum > daysInMonth) {
        cellDate = new Date(viewYear, viewMonth + 1, dayNum - daysInMonth);
        inMonth = false;
      } else {
        cellDate = new Date(viewYear, viewMonth, dayNum);
        inMonth = true;
      }

      const dateStr = fmtDate(cellDate);
      const cell = document.createElement("div");
      cell.className = "cal-cell";
      if (!inMonth) cell.classList.add("cal-cell--muted");
      if (dateStr === todayStr) cell.classList.add("cal-cell--today");
      if (isPastDate(dateStr)) cell.classList.add("cal-cell--past");
      if (isWeekend(cellDate)) cell.classList.add("cal-cell--weekend");

      const num = document.createElement("div");
      num.className = "cal-cell__num";
      num.textContent = cellDate.getDate();
      cell.appendChild(num);

      const list = document.createElement("div");
      list.className = "cal-cell__posts";
      const dayPosts = postsForDate(dateStr);
      dayPosts.slice(0, 3).forEach((p) => {
        const r = rubricById(p.typeId);
        const color = r ? r.color : "#504CFF";
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "cal-post-chip";
        chip.style.borderColor = color + "55";
        chip.style.background = color + "1a";
        chip.innerHTML =
          '<span class="cal-post-chip__dot" style="background:' + color + '"></span>' +
          '<span class="cal-post-chip__time">' + p.time + "</span>" +
          '<span class="cal-post-chip__title">' + escapeHtml(p.title) + "</span>";
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          openDetail(p);
        });
        list.appendChild(chip);
      });
      if (dayPosts.length > 3) {
        const more = document.createElement("div");
        more.className = "cal-post-more";
        more.textContent = "+" + (dayPosts.length - 3) + " ещё";
        list.appendChild(more);
      }
      cell.appendChild(list);

      // copywriter: click empty area of a present/future cell -> create
      if (isCopywriter && !isPastDate(dateStr)) {
        cell.classList.add("cal-cell--clickable");
        cell.addEventListener("click", () => openCreate(dateStr));
      }

      grid.appendChild(cell);
    }
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ==========================================================================
  // Modals
  // ==========================================================================
  function openModal(id) {
    document.getElementById(id).classList.add("is-open");
    document.body.classList.add("modal-open");
  }
  function closeModal(id) {
    document.getElementById(id).classList.remove("is-open");
    document.body.classList.remove("modal-open");
  }

  // ---- Custom confirm modal (replaces window.confirm) ----
  let confirmCallback = null;
  function askConfirm(text, onConfirm) {
    document.getElementById("confirmText").textContent = text;
    confirmCallback = onConfirm;
    openModal("confirmModal");
  }
  function initConfirmModal() {
    document.getElementById("confirmCancelBtn").addEventListener("click", () => {
      confirmCallback = null;
      closeModal("confirmModal");
    });
    document.getElementById("confirmOkBtn").addEventListener("click", () => {
      const cb = confirmCallback;
      confirmCallback = null;
      closeModal("confirmModal");
      if (cb) cb();
    });
  }

  // ---- Login modal ----
  function initLoginModal() {
    const authBtn = document.getElementById("authButton");
    authBtn.addEventListener("click", () => {
      if (isCopywriter) {
        logout();
      } else {
        document.getElementById("loginError").hidden = true;
        document.getElementById("loginPasswordInput").value = "";
        openModal("loginModal");
      }
    });

    document.getElementById("loginModalClose").addEventListener("click", () => closeModal("loginModal"));
    document.getElementById("loginModal").addEventListener("click", (e) => {
      if (e.target.id === "loginModal") closeModal("loginModal");
    });

    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const pass = document.getElementById("loginPasswordInput").value;
      const ok = await tryLogin(pass);
      if (ok) {
        closeModal("loginModal");
      } else {
        document.getElementById("loginError").hidden = false;
      }
    });
  }

  // ---- Detail modal (everyone) ----
  function openDetail(post) {
    const r = rubricById(post.typeId);
    document.getElementById("detailTitle").textContent = post.title;
    document.getElementById("detailDate").textContent = formatHumanDate(post.date);
    document.getElementById("detailTime").textContent = post.time;
    document.getElementById("detailStatus").textContent = STATUS_LABELS[post.status] || "—";

    const typeEl = document.getElementById("detailType");
    typeEl.innerHTML = r
      ? '<span class="detail-type-dot" style="background:' + r.color + '"></span>' + escapeHtml(r.name)
      : "—";

    const descRow = document.getElementById("detailDescRow");
    if (post.description) {
      descRow.hidden = false;
      document.getElementById("detailDesc").textContent = post.description;
    } else {
      descRow.hidden = true;
    }

    const editBtn = document.getElementById("detailEditBtn");
    const delBtn = document.getElementById("detailDeleteBtn");
    const past = isPastDate(post.date);

    editBtn.hidden = !isCopywriter || past;
    delBtn.hidden = !isCopywriter;

    editBtn.onclick = () => {
      closeModal("detailModal");
      openEdit(post);
    };
    delBtn.onclick = () => {
      askConfirm('Удалить пост «' + post.title + '»? Это необратимо.', () => doDelete(post.id));
    };

    openModal("detailModal");
  }
  document.getElementById("detailModalClose")?.addEventListener("click", () => closeModal("detailModal"));
  document.getElementById("detailModal")?.addEventListener("click", (e) => {
    if (e.target.id === "detailModal") closeModal("detailModal");
  });
  document.getElementById("confirmModal")?.addEventListener("click", (e) => {
    if (e.target.id === "confirmModal") {
      confirmCallback = null;
      closeModal("confirmModal");
    }
  });

  function formatHumanDate(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return d + " " + RU_MONTHS[m - 1].toLowerCase() + " " + y;
  }

  // ---- Type (rubric) and status pill selectors inside the post form ----
  function renderTypeSelect() {
    const wrap = document.getElementById("postTypeSelect");
    wrap.innerHTML = "";
    rubrics.forEach((r) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-pill";
      btn.innerHTML = '<span class="type-pill__dot" style="background:' + r.color + '"></span>' + escapeHtml(r.name);
      if (r.id === selectedTypeId) {
        btn.classList.add("type-pill--active");
        btn.style.borderColor = r.color;
        btn.style.color = r.color;
      }
      btn.addEventListener("click", () => {
        selectedTypeId = r.id;
        renderTypeSelect();
      });
      wrap.appendChild(btn);
    });
  }
  function renderStatusSelect() {
    document.querySelectorAll(".status-pill").forEach((btn) => {
      btn.classList.toggle("status-pill--active", btn.dataset.status === selectedStatus);
    });
  }
  function initStatusSelect() {
    document.querySelectorAll(".status-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedStatus = btn.dataset.status;
        renderStatusSelect();
      });
    });
  }
  function clearFieldErrors() {
    document.getElementById("postTitleInput").classList.remove("modal-input--error");
    document.getElementById("postTimeInput").classList.remove("modal-input--error");
    document.getElementById("postTitleError").hidden = true;
    document.getElementById("postTimeError").hidden = true;
    document.getElementById("postFormError").hidden = true;
  }

  // ---- Create / Edit modal (copywriter only) ----
  function openCreate(dateStr) {
    editingPostId = null;
    pendingCellDate = dateStr;
    selectedTypeId = rubrics[0] ? rubrics[0].id : null;
    selectedStatus = "draft";
    clearFieldErrors();

    const [y, m, d] = dateStr.split("-").map(Number);
    document.getElementById("postModalTitle").textContent = "Новый пост · " + d + " " + RU_MONTHS[m - 1];
    document.getElementById("postTitleInput").value = "";
    document.getElementById("postTimeInput").value = "12:00";
    document.getElementById("postDescInput").value = "";
    document.getElementById("postDeleteBtn").hidden = true;
    renderTypeSelect();
    renderStatusSelect();
    openModal("postModal");
  }

  function openEdit(post) {
    editingPostId = post.id;
    pendingCellDate = post.date;
    selectedTypeId = post.typeId;
    selectedStatus = post.status || "draft";
    clearFieldErrors();

    const [y, m, d] = post.date.split("-").map(Number);
    document.getElementById("postModalTitle").textContent = "Редактировать · " + d + " " + RU_MONTHS[m - 1];
    document.getElementById("postTitleInput").value = post.title;
    document.getElementById("postTimeInput").value = post.time;
    document.getElementById("postDescInput").value = post.description || "";
    document.getElementById("postDeleteBtn").hidden = false;
    renderTypeSelect();
    renderStatusSelect();
    openModal("postModal");
  }

  async function doDelete(id) {
    setBusy(true);
    try {
      const updated = posts.filter((p) => p.id !== id);
      await saveAll({ posts: updated, rubrics });
      posts = updated;
      render();
      closeModal("postModal");
      closeModal("detailModal");
    } catch (err) {
      alert("Ошибка: " + err.message);
    } finally {
      setBusy(false);
    }
  }

  function setBusy(busy) {
    document.body.classList.toggle("is-busy", busy);
  }

  function initPostModal() {
    document.getElementById("postModalClose").addEventListener("click", () => closeModal("postModal"));
    document.getElementById("postCancelBtn")?.addEventListener("click", () => closeModal("postModal"));
    document.getElementById("postModal").addEventListener("click", (e) => {
      if (e.target.id === "postModal") closeModal("postModal");
    });

    document.getElementById("postDeleteBtn").addEventListener("click", () => {
      if (!editingPostId) return;
      const post = posts.find((p) => p.id === editingPostId);
      if (post) askConfirm('Удалить пост «' + post.title + '»? Это необратимо.', () => doDelete(post.id));
    });

    document.getElementById("postForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      clearFieldErrors();

      const title = document.getElementById("postTitleInput").value.trim();
      const time = document.getElementById("postTimeInput").value;
      const description = document.getElementById("postDescInput").value.trim();

      let hasError = false;
      if (!title) {
        document.getElementById("postTitleInput").classList.add("modal-input--error");
        document.getElementById("postTitleError").hidden = false;
        hasError = true;
      }
      if (!time) {
        document.getElementById("postTimeInput").classList.add("modal-input--error");
        document.getElementById("postTimeError").hidden = false;
        hasError = true;
      }
      if (hasError) return;

      const date = editingPostId ? posts.find((p) => p.id === editingPostId).date : pendingCellDate;
      const errEl = document.getElementById("postFormError");

      setBusy(true);
      try {
        let updated;
        if (editingPostId) {
          updated = posts.map((p) =>
            p.id === editingPostId
              ? { ...p, title, time, description, typeId: selectedTypeId, status: selectedStatus }
              : p
          );
        } else {
          updated = [...posts, {
            id: uid(), title, date, time, description,
            typeId: selectedTypeId, status: selectedStatus,
          }];
        }
        await saveAll({ posts: updated, rubrics });
        posts = updated;
        render();
        closeModal("postModal");
      } catch (err) {
        errEl.textContent = "Ошибка сохранения: " + err.message;
        errEl.hidden = false;
      } finally {
        setBusy(false);
      }
    });
  }

  // ==========================================================================
  // Navigation
  // ==========================================================================
  function initNav() {
    document.getElementById("calPrev").addEventListener("click", () => {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      render();
    });
    document.getElementById("calNext").addEventListener("click", () => {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      render();
    });
    document.getElementById("calToday").addEventListener("click", () => {
      viewYear = todayObj.getFullYear();
      viewMonth = todayObj.getMonth();
      render();
    });
  }

  // ==========================================================================
  // Boot
  // ==========================================================================
  async function boot() {
    viewYear = todayObj.getFullYear();
    viewMonth = todayObj.getMonth();

    const demoBanner = document.getElementById("demoBanner");
    if (demoBanner) demoBanner.hidden = isConfigured;

    checkStoredAuth();
    initLoginModal();
    initPostModal();
    initRubricsModal();
    initConfirmModal();
    initStatusSelect();
    initNav();

    const errBanner = document.getElementById("calLoadError");
    try {
      const data = await loadAll();
      posts = data.posts;
      rubrics = data.rubrics;
      renderLegend();
      render();
    } catch (err) {
      errBanner.hidden = false;
      errBanner.textContent =
        "Не удалось загрузить календарь: " + err.message + " — проверьте config.js (jsonbinBinId).";
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();