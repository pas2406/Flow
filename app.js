(function () {
  "use strict";

  const STORAGE_KEY = "flow.kanban.v3";
  const OLD_KEYS = ["flow.kanban.v2", "flow.kanban.v1"];

  // Étapes par défaut d'un nouveau projet.
  const DEFAULT_COLUMNS = [
    { id: "todo",   title: "À faire" },
    { id: "doing",  title: "En cours" },
    { id: "review", title: "En revue" },
    { id: "done",   title: "Terminé" },
  ];

  const PRIORITIES = ["low", "medium", "high"];

  // state = { projects: [ { id, name, columns:[{id,title}], cards:[{id,text,priority,columnId}] } ], activeId, view }
  let state = { projects: [], activeId: null, view: "projects" };
  let justAddedId = null;
  let projectSearch = "";
  let selectionMode = false;
  const selectedProjects = new Set();

  // ── Éléments ────────────────────────────────────────────
  const viewProjects = document.getElementById("view-projects");
  const viewBoard = document.getElementById("view-board");
  const projectGrid = document.getElementById("project-grid");
  const projectsCount = document.getElementById("projects-count");
  const projectAddBtn = document.getElementById("project-add");
  const projectSearchInput = document.getElementById("project-search-input");
  const selectionBar = document.getElementById("selection-bar");
  const selectionCount = document.getElementById("selection-count");
  const selectionAllBtn = document.getElementById("selection-all");
  const selectionClearBtn = document.getElementById("selection-clear");
  const selectionDeleteBtn = document.getElementById("selection-delete");
  const selectionToggleBtn = document.getElementById("selection-toggle");
  const backBtn = document.getElementById("back-btn");
  const boardTitle = document.getElementById("board-title");
  const board = document.getElementById("board");
  const columnTemplate = document.getElementById("column-template");
  const cardTemplate = document.getElementById("card-template");
  const totalStat = document.getElementById("stat-total");
  const progressFill = document.getElementById("progress-fill");
  const progressLabel = document.getElementById("progress-label");
  const resetBtn = document.getElementById("reset-btn");
  const modalOverlay = document.getElementById("modal-overlay");
  const modalConfirm = document.getElementById("modal-confirm");
  const modalCancel = document.getElementById("modal-cancel");
  const modalTitle = document.getElementById("modal-title");
  const modalText = document.getElementById("modal-text");
  const modalIcon = document.getElementById("modal-icon");

  // ── Persistance & migration ─────────────────────────────
  function sanitizeColumns(arr) {
    if (!Array.isArray(arr)) return null;
    const cols = arr
      .filter((c) => c && typeof c.id === "string")
      .map((c) => ({ id: c.id, title: String(c.title || "Étape") }));
    return cols.length ? cols : null;
  }

  function sanitizeProject(p) {
    if (!p || typeof p.id !== "string") return null;
    const columns = sanitizeColumns(p.columns) || DEFAULT_COLUMNS.map((c) => ({ ...c }));
    const colIds = new Set(columns.map((c) => c.id));
    const fallback = columns[0].id;
    const cards = Array.isArray(p.cards)
      ? p.cards
          .filter((c) => c && typeof c.id === "string")
          .map((c) => ({
            id: c.id,
            text: String(c.text || ""),
            priority: PRIORITIES.includes(c.priority) ? c.priority : "medium",
            columnId: colIds.has(c.columnId) ? c.columnId : fallback,
          }))
      : [];
    return { id: p.id, name: String(p.name || "Projet"), columns, cards };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.projects)) {
          state.projects = parsed.projects.map(sanitizeProject).filter(Boolean);
          if (state.projects.length) {
            state.activeId = state.projects.some((p) => p.id === parsed.activeId)
              ? parsed.activeId
              : null;
            state.view = parsed.view === "board" && state.activeId ? "board" : "projects";
            return;
          }
        }
      }

      // Migration depuis les anciens formats.
      const v2 = localStorage.getItem("flow.kanban.v2");
      if (v2) {
        const parsed = JSON.parse(v2);
        if (parsed && Array.isArray(parsed.projects)) {
          state.projects = parsed.projects.map(sanitizeProject).filter(Boolean);
          if (state.projects.length) { save(); return; }
        }
      }
      const v1 = localStorage.getItem("flow.kanban.v1");
      if (v1) {
        const parsed = JSON.parse(v1);
        if (parsed && Array.isArray(parsed.cards)) {
          state.projects = [sanitizeProject({ id: uid(), name: "Mon projet", cards: parsed.cards })];
          save();
          return;
        }
      }
    } catch (err) {
      console.warn("Flow : impossible de charger l'état, réinitialisation.", err);
      state = { projects: [], activeId: null, view: "projects" };
    }

    ensureAtLeastOneProject();
  }

  function ensureAtLeastOneProject() {
    if (!state.projects.length) {
      state.projects = [makeProject("Mon projet")];
      save();
    }
  }

  function makeProject(name) {
    return {
      id: uid(),
      name: name,
      columns: DEFAULT_COLUMNS.map((c) => ({ ...c, id: uid() })),
      cards: [],
    };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("Flow : impossible de sauvegarder l'état.", err);
    }
  }

  function uid() {
    return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  // ── Helpers ─────────────────────────────────────────────
  function activeProject() {
    return state.projects.find((p) => p.id === state.activeId) || null;
  }

  function selectAll(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Édition inline d'un texte (nom de projet, titre d'étape).
  function editText(el, onCommit) {
    el.setAttribute("contenteditable", "true");
    el.classList.add("editing");
    el.focus();
    selectAll(el);

    function finish(saveIt) {
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("keydown", onKey);
      el.removeAttribute("contenteditable");
      el.classList.remove("editing");
      onCommit(saveIt ? el.textContent : null);
    }
    function onBlur() { finish(true); }
    function onKey(ev) {
      if (ev.key === "Enter") { ev.preventDefault(); el.blur(); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    }
    el.addEventListener("blur", onBlur);
    el.addEventListener("keydown", onKey);
  }

  // Teinte stable dérivée du nom (avatar coloré par projet).
  function hueFromString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  function uniqueName(desired, excludeId) {
    const base = (desired || "").trim() || "Projet";
    const taken = new Set(
      state.projects
        .filter((p) => p.id !== excludeId)
        .map((p) => p.name.trim().toLowerCase())
    );
    if (!taken.has(base.toLowerCase())) return base;
    let n = 2;
    while (taken.has((base + " (" + n + ")").toLowerCase())) n++;
    return base + " (" + n + ")";
  }

  // ── Modale de confirmation ──────────────────────────────
  function openModal(opts) {
    opts = opts || {};
    if (modalIcon) modalIcon.textContent = opts.icon || "↺";
    if (modalTitle) modalTitle.textContent = opts.title || "Confirmer ?";
    if (modalText) modalText.textContent = opts.text || "";
    if (modalConfirm) modalConfirm.textContent = opts.confirm || "Continuer";

    return new Promise((resolve) => {
      modalOverlay.hidden = false;

      function close(result) {
        modalOverlay.classList.add("closing");
        document.removeEventListener("keydown", onKey);
        modalConfirm.removeEventListener("click", onConfirm);
        modalCancel.removeEventListener("click", onCancel);
        modalOverlay.removeEventListener("click", onBackdrop);
        setTimeout(function () {
          modalOverlay.hidden = true;
          modalOverlay.classList.remove("closing");
          resolve(result);
        }, 180);
      }

      function onConfirm() { close(true); }
      function onCancel() { close(false); }
      function onBackdrop(e) { if (e.target === modalOverlay) close(false); }
      function onKey(e) {
        if (e.key === "Escape") close(false);
        else if (e.key === "Enter") close(true);
      }

      modalConfirm.addEventListener("click", onConfirm);
      modalCancel.addEventListener("click", onCancel);
      modalOverlay.addEventListener("click", onBackdrop);
      document.addEventListener("keydown", onKey);
      modalCancel.focus();
    });
  }

  // ── Navigation entre vues ───────────────────────────────
  function showProjects() {
    state.view = "projects";
    state.activeId = null;
    // Réinitialise le mode sélection en revenant à la liste.
    selectionMode = false;
    selectedProjects.clear();
    if (selectionToggleBtn) {
      selectionToggleBtn.classList.remove("active");
      selectionToggleBtn.setAttribute("aria-pressed", "false");
    }
    projectGrid.classList.remove("selecting");
    save();
    viewBoard.hidden = true;
    viewProjects.hidden = false;
    renderProjectGrid();
  }

  function openProject(id) {
    const proj = state.projects.find((p) => p.id === id);
    if (!proj) return;
    state.activeId = id;
    state.view = "board";
    justAddedId = null;
    save();
    viewProjects.hidden = true;
    viewBoard.hidden = false;
    boardTitle.textContent = proj.name;
    renderBoard();
  }

  // ── Projets ─────────────────────────────────────────────
  function createProject() {
    const proj = makeProject(uniqueName("Nouveau projet", null));
    state.projects.push(proj);
    projectSearch = "";
    if (projectSearchInput) projectSearchInput.value = "";
    save();
    renderProjectGrid();
    const nameEl = projectGrid.querySelector(
      '[data-project-id="' + proj.id + '"] .project-card-name'
    );
    if (nameEl) startRenameProject(nameEl, proj.id);
  }

  function renameProject(id, name) {
    const proj = state.projects.find((p) => p.id === id);
    if (!proj) return;
    proj.name = uniqueName(name, id);
    save();
    renderProjectGrid();
    if (state.activeId === id) boardTitle.textContent = proj.name;
  }

  function startRenameProject(nameEl, id) {
    editText(nameEl, function (val) {
      if (val !== null) renameProject(id, val);
      else renderProjectGrid();
    });
  }

  function deleteProject(id) {
    const proj = state.projects.find((p) => p.id === id);
    if (!proj) return;
    openModal({
      icon: "🗑",
      title: "Supprimer le projet ?",
      text: "« " + proj.name + " » et toutes ses tâches seront définitivement supprimés.",
      confirm: "Supprimer",
    }).then(function (ok) {
      if (!ok) return;
      state.projects = state.projects.filter((p) => p.id !== id);
      ensureAtLeastOneProject();
      save();
      renderProjectGrid();
    });
  }

  function renderProjectGrid() {
    projectGrid.innerHTML = "";

    if (projectsCount) {
      const t = state.projects.length;
      projectsCount.textContent = t + " projet" + (t > 1 ? "s" : "");
    }

    const term = projectSearch.trim().toLowerCase();
    const list = term
      ? state.projects.filter((p) => p.name.toLowerCase().includes(term))
      : state.projects;

    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "grid-empty";
      empty.textContent = term ? "Aucun projet ne correspond à « " + projectSearch.trim() + " »." : "Aucun projet.";
      projectGrid.appendChild(empty);
      return;
    }

    list.forEach(function (p) {
      const card = document.createElement("article");
      card.className = "project-card" + (selectedProjects.has(p.id) ? " selected" : "");
      card.dataset.projectId = p.id;
      card.tabIndex = 0;

      const head = document.createElement("div");
      head.className = "project-card-head";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "project-card-check";
      check.checked = selectedProjects.has(p.id);
      check.setAttribute("aria-label", "Sélectionner « " + p.name + " »");
      head.appendChild(check);

      const avatar = document.createElement("span");
      avatar.className = "project-card-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = (p.name.trim()[0] || "?").toUpperCase();
      const hue = hueFromString(p.name || p.id);
      avatar.style.background =
        "linear-gradient(135deg, hsl(" + hue + ", 62%, 55%), hsl(" + ((hue + 45) % 360) + ", 68%, 42%))";
      head.appendChild(avatar);

      const name = document.createElement("h3");
      name.className = "project-card-name";
      name.textContent = p.name;
      head.appendChild(name);

      const del = document.createElement("button");
      del.className = "project-card-del";
      del.type = "button";
      del.title = "Supprimer le projet";
      del.setAttribute("aria-label", "Supprimer le projet");
      del.textContent = "×";
      head.appendChild(del);

      card.appendChild(head);

      const total = p.cards.length;
      const lastCol = p.columns[p.columns.length - 1];
      const done = lastCol ? p.cards.filter((c) => c.columnId === lastCol.id).length : 0;
      const pct = total ? Math.round((done / total) * 100) : 0;

      const meta = document.createElement("p");
      meta.className = "project-card-meta";
      meta.textContent =
        total + " tâche" + (total > 1 ? "s" : "") + " · " +
        p.columns.length + " étape" + (p.columns.length > 1 ? "s" : "");
      card.appendChild(meta);

      const progress = document.createElement("div");
      progress.className = "project-card-progress";
      const bar = document.createElement("div");
      bar.className = "project-card-bar";
      const fill = document.createElement("div");
      fill.className = "project-card-fill";
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      progress.appendChild(bar);
      const pctLabel = document.createElement("span");
      pctLabel.className = "project-card-pct";
      pctLabel.textContent = pct + "%";
      progress.appendChild(pctLabel);
      card.appendChild(progress);

      const open = document.createElement("span");
      open.className = "project-card-open";
      open.textContent = "Ouvrir le tableau →";
      card.appendChild(open);

      projectGrid.appendChild(card);
    });

    updateSelectionUI();
  }

  // ── Sélection multiple de projets ───────────────────────
  function updateSelectionUI() {
    // Retire les ids qui n'existent plus.
    [...selectedProjects].forEach(function (id) {
      if (!state.projects.some((p) => p.id === id)) selectedProjects.delete(id);
    });
    const n = selectedProjects.size;
    if (selectionBar) selectionBar.hidden = !selectionMode;
    if (selectionDeleteBtn) selectionDeleteBtn.disabled = n === 0;
    if (selectionCount) {
      selectionCount.textContent =
        n === 0
          ? "Sélectionnez des projets"
          : n + " projet" + (n > 1 ? "s" : "") + " sélectionné" + (n > 1 ? "s" : "");
    }
  }

  function setSelectionMode(on) {
    selectionMode = on;
    if (!on) selectedProjects.clear();
    if (selectionToggleBtn) {
      selectionToggleBtn.classList.toggle("active", on);
      selectionToggleBtn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    projectGrid.classList.toggle("selecting", on);
    renderProjectGrid();
  }

  function setProjectSelected(id, on) {
    if (on) selectedProjects.add(id);
    else selectedProjects.delete(id);
    const card = projectGrid.querySelector('[data-project-id="' + id + '"]');
    if (card) {
      card.classList.toggle("selected", on);
      const cb = card.querySelector(".project-card-check");
      if (cb) cb.checked = on;
    }
    updateSelectionUI();
  }

  function selectAllVisible() {
    const term = projectSearch.trim().toLowerCase();
    const list = term
      ? state.projects.filter((p) => p.name.toLowerCase().includes(term))
      : state.projects;
    list.forEach((p) => selectedProjects.add(p.id));
    renderProjectGrid();
  }

  function deleteSelectedProjects() {
    const ids = [...selectedProjects].filter((id) => state.projects.some((p) => p.id === id));
    if (!ids.length) return;
    openModal({
      icon: "🗑",
      title: ids.length > 1 ? "Supprimer " + ids.length + " projets ?" : "Supprimer le projet ?",
      text:
        (ids.length > 1 ? "Ces projets" : "Ce projet") +
        " et toutes leurs tâches seront définitivement supprimés.",
      confirm: "Supprimer",
    }).then(function (ok) {
      if (!ok) return;
      const idSet = new Set(ids);
      state.projects = state.projects.filter((p) => !idSet.has(p.id));
      selectedProjects.clear();
      ensureAtLeastOneProject();
      save();
      renderProjectGrid();
    });
  }

  projectGrid.addEventListener("change", function (e) {
    const check = e.target.closest(".project-card-check");
    if (!check) return;
    const card = e.target.closest(".project-card");
    setProjectSelected(card.dataset.projectId, check.checked);
  });

  if (selectionToggleBtn) {
    selectionToggleBtn.addEventListener("click", function () {
      setSelectionMode(!selectionMode);
    });
  }
  if (selectionAllBtn) selectionAllBtn.addEventListener("click", selectAllVisible);
  if (selectionClearBtn) selectionClearBtn.addEventListener("click", function () {
    setSelectionMode(false);
  });
  if (selectionDeleteBtn) selectionDeleteBtn.addEventListener("click", deleteSelectedProjects);

  projectGrid.addEventListener("click", function (e) {
    const card = e.target.closest(".project-card");
    if (!card) return;
    const id = card.dataset.projectId;
    if (e.target.closest(".project-card-del")) {
      deleteProject(id);
      return;
    }
    if (e.target.closest('[contenteditable="true"]')) return;
    if (e.target.closest(".project-card-check")) return; // géré par l'événement 'change'
    if (selectionMode) {
      setProjectSelected(id, !selectedProjects.has(id));
      return;
    }
    openProject(id);
  });

  projectGrid.addEventListener("dblclick", function (e) {
    const nameEl = e.target.closest(".project-card-name");
    if (!nameEl) return;
    e.stopPropagation();
    const card = e.target.closest(".project-card");
    startRenameProject(nameEl, card.dataset.projectId);
  });

  projectGrid.addEventListener("keydown", function (e) {
    const card = e.target.closest(".project-card");
    if (!card) return;
    if ((e.key === "Enter" || e.key === " ") && !e.target.closest('[contenteditable="true"]')) {
      e.preventDefault();
      const id = card.dataset.projectId;
      if (selectionMode) setProjectSelected(id, !selectedProjects.has(id));
      else openProject(id);
    }
  });

  if (projectAddBtn) projectAddBtn.addEventListener("click", createProject);
  if (backBtn) backBtn.addEventListener("click", showProjects);

  if (projectSearchInput) {
    projectSearchInput.addEventListener("input", function () {
      projectSearch = projectSearchInput.value;
      renderProjectGrid();
    });
  }

  if (boardTitle) {
    boardTitle.addEventListener("dblclick", function () {
      const proj = activeProject();
      if (proj) startRenameProject2(boardTitle, proj.id);
    });
  }
  // Renommage depuis le titre du tableau (met aussi à jour la grille).
  function startRenameProject2(el, id) {
    editText(el, function (val) {
      if (val !== null) renameProject(id, val);
      else {
        const proj = activeProject();
        if (proj) el.textContent = proj.name;
      }
    });
  }

  // ── Étapes (colonnes) ───────────────────────────────────
  function addColumn() {
    const proj = activeProject();
    if (!proj) return;
    const col = { id: uid(), title: "Nouvelle étape" };
    proj.columns.push(col);
    save();
    renderBoard();
    const titleEl = board.querySelector(
      '[data-column-id="' + col.id + '"] .column-title'
    );
    if (titleEl) startRenameColumn(titleEl, col.id);
  }

  function renameColumn(id, title) {
    const proj = activeProject();
    if (!proj) return;
    const col = proj.columns.find((c) => c.id === id);
    if (!col) return;
    col.title = (title || "").trim() || "Étape";
    save();
    renderBoard();
  }

  function startRenameColumn(titleEl, id) {
    editText(titleEl, function (val) {
      if (val !== null) renameColumn(id, val);
      else renderBoard();
    });
  }

  function removeColumn(id) {
    const proj = activeProject();
    if (!proj || proj.columns.length <= 1) return;
    const col = proj.columns.find((c) => c.id === id);
    if (!col) return;
    const count = proj.cards.filter((c) => c.columnId === id).length;

    function doRemove() {
      proj.columns = proj.columns.filter((c) => c.id !== id);
      proj.cards = proj.cards.filter((c) => c.columnId !== id);
      save();
      renderBoard();
    }

    if (count > 0) {
      openModal({
        icon: "🗑",
        title: "Supprimer l'étape ?",
        text: "« " + col.title + " » et ses " + count + " tâche" + (count > 1 ? "s" : "") + " seront supprimées.",
        confirm: "Supprimer",
      }).then(function (ok) {
        if (ok) doRemove();
      });
    } else {
      doRemove();
    }
  }

  // ── Cartes ──────────────────────────────────────────────
  function getCard(id) {
    const proj = activeProject();
    return proj ? proj.cards.find((c) => c.id === id) || null : null;
  }

  function addCard(columnId, text, priority) {
    const clean = text.trim();
    if (!clean) return;
    const proj = activeProject();
    if (!proj) return;
    const id = uid();
    proj.cards.push({ id: id, text: clean, priority: priority || "medium", columnId: columnId });
    justAddedId = id;
    save();
    renderCards();
  }

  function deleteCard(id) {
    const proj = activeProject();
    if (!proj) return;
    proj.cards = proj.cards.filter((c) => c.id !== id);
    save();
    renderCards();
  }

  function editCard(id, newText) {
    const card = getCard(id);
    if (!card) return;
    const clean = newText.trim();
    if (!clean) {
      deleteCard(id);
      return;
    }
    card.text = clean;
    save();
    renderCards();
  }

  function moveCard(id, targetColumnId, beforeId) {
    const proj = activeProject();
    if (!proj) return;
    const idx = proj.cards.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const [card] = proj.cards.splice(idx, 1);
    card.columnId = targetColumnId;

    if (beforeId) {
      const beforeIdx = proj.cards.findIndex((c) => c.id === beforeId);
      if (beforeIdx !== -1) {
        proj.cards.splice(beforeIdx, 0, card);
        save();
        renderCards();
        return;
      }
    }
    proj.cards.push(card);
    save();
    renderCards();
  }

  function resetAll() {
    const proj = activeProject();
    if (!proj || proj.cards.length === 0) return;
    openModal({
      icon: "↺",
      title: "Réinitialiser le projet ?",
      text: "Toutes les tâches de « " + proj.name + " » seront définitivement supprimées.",
      confirm: "Continuer",
    }).then(function (ok) {
      if (!ok) return;
      proj.cards = [];
      justAddedId = null;
      save();
      renderCards();
    });
  }

  // ── Rendu du tableau ────────────────────────────────────
  function buildCardElement(card) {
    const node = cardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.cardId = card.id;
    node.dataset.priority = card.priority;
    node.querySelector(".card-text").textContent = card.text;
    if (card.id === justAddedId) {
      node.classList.add("card-new");
      justAddedId = null;
    }
    return node;
  }

  function buildColumnElement(col, single) {
    const node = columnTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.columnId = col.id;

    const titleEl = node.querySelector(".column-title");
    titleEl.textContent = col.title;
    titleEl.addEventListener("dblclick", function () {
      startRenameColumn(titleEl, col.id);
    });

    const del = node.querySelector(".column-del");
    if (single) {
      del.remove();
    } else {
      del.addEventListener("click", function () {
        removeColumn(col.id);
      });
    }

    const prioSelect = node.querySelector(".prio-select");
    setupPrioritySelect(prioSelect);

    const form = node.querySelector(".add-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const input = form.querySelector(".add-input");
      addCard(col.id, input.value, prioSelect.dataset.value);
      input.value = "";
      input.focus();
    });

    const dropzone = node.querySelector(".cards");
    setupDropzone(dropzone, col.id);

    return node;
  }

  function renderBoard() {
    board.innerHTML = "";
    const proj = activeProject();
    if (!proj) return;

    const single = proj.columns.length <= 1;
    proj.columns.forEach(function (col) {
      board.appendChild(buildColumnElement(col, single));
    });

    const addCol = document.createElement("button");
    addCol.className = "add-column";
    addCol.type = "button";
    addCol.innerHTML = '<span aria-hidden="true">+</span> Ajouter une étape';
    addCol.addEventListener("click", addColumn);
    board.appendChild(addCol);

    renderCards();
  }

  function renderCards() {
    const proj = activeProject();
    if (!proj) return;

    proj.columns.forEach(function (col) {
      const section = board.querySelector('[data-column-id="' + col.id + '"]');
      if (!section) return;
      const cardsZone = section.querySelector(".cards");
      cardsZone.innerHTML = "";
      const colCards = proj.cards.filter((c) => c.columnId === col.id);
      colCards.forEach((c) => cardsZone.appendChild(buildCardElement(c)));
      section.querySelector(".column-count").textContent = colCards.length;
    });

    renderStats();
  }

  function renderStats() {
    const proj = activeProject();
    if (!proj) return;
    const total = proj.cards.length;
    totalStat.textContent = total;

    const lastCol = proj.columns[proj.columns.length - 1];
    const done = lastCol ? proj.cards.filter((c) => c.columnId === lastCol.id).length : 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    progressFill.style.width = pct + "%";
    progressLabel.textContent = pct + "%";
  }

  // ── Liste de priorité personnalisée ─────────────────────
  function closeAllPrioritySelects() {
    document.querySelectorAll(".prio-select.open").forEach(function (el) {
      el.classList.remove("open");
      const t = el.querySelector(".prio-trigger");
      if (t) t.setAttribute("aria-expanded", "false");
    });
  }

  function setupPrioritySelect(root) {
    const trigger = root.querySelector(".prio-trigger");
    const labelEl = trigger.querySelector(".prio-label");
    const dotEl = trigger.querySelector(".prio-dot");
    const options = root.querySelectorAll(".prio-option");

    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      const wasOpen = root.classList.contains("open");
      closeAllPrioritySelects();
      if (!wasOpen) {
        root.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
      }
    });

    options.forEach(function (opt) {
      opt.addEventListener("click", function (e) {
        e.stopPropagation();
        const val = opt.dataset.value;
        root.dataset.value = val;
        labelEl.textContent = opt.dataset.label;
        dotEl.dataset.prio = val;
        options.forEach(function (o) {
          o.setAttribute("aria-selected", o === opt ? "true" : "false");
        });
        closeAllPrioritySelects();
      });
    });
  }

  document.addEventListener("click", closeAllPrioritySelects);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAllPrioritySelects();
  });

  // ── Glisser-déposer ─────────────────────────────────────
  let draggedId = null;

  function getCardAfter(container, y) {
    const cards = [...container.querySelectorAll(".card:not(.dragging)")];
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        closest = { offset: offset, element: card };
      }
    }
    return closest.element;
  }

  function setupDropzone(dropzone, columnId) {
    dropzone.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      dropzone.classList.add("drag-over");
    });

    dropzone.addEventListener("dragleave", function (e) {
      if (!dropzone.contains(e.relatedTarget)) {
        dropzone.classList.remove("drag-over");
      }
    });

    dropzone.addEventListener("drop", function (e) {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
      if (!draggedId) return;
      const afterEl = getCardAfter(dropzone, e.clientY);
      const beforeId = afterEl ? afterEl.dataset.cardId : null;
      moveCard(draggedId, columnId, beforeId);
    });
  }

  board.addEventListener("dragstart", function (e) {
    const card = e.target.closest(".card");
    if (!card) return;
    draggedId = card.dataset.cardId;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", draggedId); } catch (_) {}
  });

  board.addEventListener("dragend", function (e) {
    const card = e.target.closest(".card");
    if (card) card.classList.remove("dragging");
    draggedId = null;
    document.querySelectorAll(".cards.drag-over").forEach((z) => z.classList.remove("drag-over"));
  });

  board.addEventListener("click", function (e) {
    const card = e.target.closest(".card");
    if (!card) return;
    const id = card.dataset.cardId;

    if (e.target.closest(".card-delete")) {
      deleteCard(id);
      return;
    }
    if (e.target.closest(".card-edit")) {
      startEditing(card, id);
    }
  });

  function startEditing(cardEl, id) {
    const p = cardEl.querySelector(".card-text");
    cardEl.setAttribute("draggable", "false");
    p.setAttribute("contenteditable", "true");
    p.focus();

    const range = document.createRange();
    range.selectNodeContents(p);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function finish(saveChanges) {
      p.removeEventListener("blur", onBlur);
      p.removeEventListener("keydown", onKey);
      p.removeAttribute("contenteditable");
      cardEl.setAttribute("draggable", "true");
      if (saveChanges) {
        editCard(id, p.textContent);
      } else {
        renderCards();
      }
    }

    function onBlur() { finish(true); }
    function onKey(ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        p.blur();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
    }

    p.addEventListener("blur", onBlur);
    p.addEventListener("keydown", onKey);
  }

  if (resetBtn) resetBtn.addEventListener("click", resetAll);

  // ── Démarrage ───────────────────────────────────────────
  load();
  if (state.view === "board" && activeProject()) {
    openProject(state.activeId);
  } else {
    showProjects();
  }
})();
