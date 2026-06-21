(function () {
  "use strict";

  const STORAGE_KEY = "flow.kanban.v2";
  const OLD_STORAGE_KEY = "flow.kanban.v1";

  const COLUMNS = [
    { id: "todo",   title: "À faire" },
    { id: "doing",  title: "En cours" },
    { id: "review", title: "En revue" },
    { id: "done",   title: "Terminé" },
  ];

  const DONE_COLUMN = "done";

  // state = { projects: [ { id, name, cards: [...] } ], activeId }
  let state = { projects: [], activeId: null };
  let justAddedId = null;

  const board = document.getElementById("board");
  const columnTemplate = document.getElementById("column-template");
  const cardTemplate = document.getElementById("card-template");
  const progressFill = document.getElementById("progress-fill");
  const progressLabel = document.getElementById("progress-label");
  const resetBtn = document.getElementById("reset-btn");
  const projectTabs = document.getElementById("project-tabs");
  const projectAddBtn = document.getElementById("project-add");
  const modalOverlay = document.getElementById("modal-overlay");
  const modalConfirm = document.getElementById("modal-confirm");
  const modalCancel = document.getElementById("modal-cancel");
  const modalTitle = document.getElementById("modal-title");
  const modalText = document.getElementById("modal-text");
  const modalIcon = document.getElementById("modal-icon");

  // ── Persistance ─────────────────────────────────────────
  function sanitizeCards(arr) {
    const validIds = new Set(COLUMNS.map((c) => c.id));
    return arr
      .filter((c) => c && typeof c.id === "string" && validIds.has(c.columnId))
      .map((c) => ({
        id: c.id,
        text: String(c.text || ""),
        priority: ["low", "medium", "high"].includes(c.priority) ? c.priority : "medium",
        columnId: c.columnId,
      }));
  }

  function sanitizeProject(p) {
    if (!p || typeof p.id !== "string") return null;
    return {
      id: p.id,
      name: String(p.name || "Projet"),
      cards: Array.isArray(p.cards) ? sanitizeCards(p.cards) : [],
    };
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
              : state.projects[0].id;
            return;
          }
        }
      }

      // Migration depuis l'ancien format mono-tableau (v1)
      const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
      if (oldRaw) {
        const old = JSON.parse(oldRaw);
        if (old && Array.isArray(old.cards)) {
          const proj = { id: uid(), name: "Mon projet", cards: sanitizeCards(old.cards) };
          state.projects = [proj];
          state.activeId = proj.id;
          save();
          return;
        }
      }
    } catch (err) {
      console.warn("Flow : impossible de charger l'état, réinitialisation.", err);
      state = { projects: [], activeId: null };
    }

    ensureDefaultProject();
  }

  function ensureDefaultProject() {
    if (!state.projects.length) {
      const proj = { id: uid(), name: "Mon projet", cards: [] };
      state.projects = [proj];
      state.activeId = proj.id;
      save();
    } else if (!state.projects.some((p) => p.id === state.activeId)) {
      state.activeId = state.projects[0].id;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("Flow : impossible de sauvegarder l'état.", err);
    }
  }

  function uid() {
    return "c_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  // ── Projet actif ────────────────────────────────────────
  function activeProject() {
    return state.projects.find((p) => p.id === state.activeId) || state.projects[0] || null;
  }

  function activeCards() {
    const p = activeProject();
    return p ? p.cards : [];
  }

  // ── Cartes ──────────────────────────────────────────────
  function getCard(id) {
    return activeCards().find((c) => c.id === id) || null;
  }

  function addCard(columnId, text, priority) {
    const clean = text.trim();
    if (!clean) return;
    const proj = activeProject();
    if (!proj) return;
    const id = uid();
    proj.cards.push({
      id: id,
      text: clean,
      priority: priority || "medium",
      columnId: columnId,
    });
    justAddedId = id;
    save();
    render();
  }

  function deleteCard(id) {
    const proj = activeProject();
    if (!proj) return;
    proj.cards = proj.cards.filter((c) => c.id !== id);
    save();
    render();
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
    render();
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
        render();
        return;
      }
    }
    proj.cards.push(card);
    save();
    render();
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
      render();
    });
  }

  // ── Projets ─────────────────────────────────────────────
  function switchProject(id) {
    if (id === state.activeId) return;
    if (!state.projects.some((p) => p.id === id)) return;
    state.activeId = id;
    justAddedId = null;
    save();
    renderProjects();
    render();
  }

  function createProject() {
    const proj = { id: uid(), name: "Nouveau projet", cards: [] };
    state.projects.push(proj);
    state.activeId = proj.id;
    save();
    renderProjects();
    render();
    const tab = projectTabs.querySelector('[data-project-id="' + proj.id + '"]');
    if (tab) startRenameProject(tab, proj.id);
  }

  function renameProject(id, name) {
    const proj = state.projects.find((p) => p.id === id);
    if (!proj) return;
    const clean = name.trim();
    proj.name = clean || "Projet";
    save();
    renderProjects();
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
      justAddedId = null;
      ensureDefaultProject();
      if (state.activeId === id) {
        state.activeId = state.projects[0].id;
      }
      save();
      renderProjects();
      render();
    });
  }

  function startRenameProject(tab, id) {
    const nameEl = tab.querySelector(".project-tab-name");
    tab.classList.add("editing");
    nameEl.setAttribute("contenteditable", "true");
    nameEl.focus();

    const range = document.createRange();
    range.selectNodeContents(nameEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function finish(saveChanges) {
      nameEl.removeEventListener("blur", onBlur);
      nameEl.removeEventListener("keydown", onKey);
      nameEl.removeAttribute("contenteditable");
      tab.classList.remove("editing");
      if (saveChanges) {
        renameProject(id, nameEl.textContent);
      } else {
        renderProjects();
      }
    }

    function onBlur() { finish(true); }
    function onKey(ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        nameEl.blur();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
    }

    nameEl.addEventListener("blur", onBlur);
    nameEl.addEventListener("keydown", onKey);
  }

  function renderProjects() {
    projectTabs.innerHTML = "";
    state.projects.forEach(function (p) {
      const tab = document.createElement("div");
      tab.className = "project-tab" + (p.id === state.activeId ? " active" : "");
      tab.dataset.projectId = p.id;
      tab.tabIndex = 0;
      tab.title = "Cliquer pour ouvrir · double-clic pour renommer";

      const name = document.createElement("span");
      name.className = "project-tab-name";
      name.textContent = p.name;
      tab.appendChild(name);

      const count = document.createElement("span");
      count.className = "project-tab-count";
      count.textContent = p.cards.length;
      tab.appendChild(count);

      const del = document.createElement("button");
      del.className = "project-tab-del";
      del.type = "button";
      del.title = "Supprimer le projet";
      del.setAttribute("aria-label", "Supprimer le projet");
      del.textContent = "×";
      tab.appendChild(del);

      projectTabs.appendChild(tab);
    });
  }

  projectTabs.addEventListener("click", function (e) {
    const tab = e.target.closest(".project-tab");
    if (!tab) return;
    const id = tab.dataset.projectId;
    if (e.target.closest(".project-tab-del")) {
      deleteProject(id);
      return;
    }
    switchProject(id);
  });

  projectTabs.addEventListener("dblclick", function (e) {
    const tab = e.target.closest(".project-tab");
    if (!tab) return;
    startRenameProject(tab, tab.dataset.projectId);
  });

  projectTabs.addEventListener("keydown", function (e) {
    const tab = e.target.closest(".project-tab");
    if (!tab) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      switchProject(tab.dataset.projectId);
    }
  });

  if (projectAddBtn) projectAddBtn.addEventListener("click", createProject);

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

  function renderStats() {
    const cards = activeCards();
    const counts = { total: cards.length };
    COLUMNS.forEach((col) => {
      counts[col.id] = cards.filter((c) => c.columnId === col.id).length;
    });

    document.querySelectorAll("[data-stat]").forEach((el) => {
      const key = el.getAttribute("data-stat");
      el.textContent = counts[key] != null ? counts[key] : 0;
    });

    const done = counts[DONE_COLUMN] || 0;
    const pct = counts.total > 0 ? Math.round((done / counts.total) * 100) : 0;
    progressFill.style.width = pct + "%";
    progressLabel.textContent = pct + "%";

    COLUMNS.forEach((col) => {
      const section = board.querySelector('[data-column-id="' + col.id + '"]');
      if (section) section.querySelector(".column-count").textContent = counts[col.id];
    });
  }

  function render() {
    if (!board.children.length) {
      COLUMNS.forEach((col) => board.appendChild(buildColumnElement(col)));
    }

    const cards = activeCards();
    COLUMNS.forEach((col) => {
      const section = board.querySelector('[data-column-id="' + col.id + '"]');
      const cardsZone = section.querySelector(".cards");
      cardsZone.innerHTML = "";
      cards
        .filter((c) => c.columnId === col.id)
        .forEach((c) => cardsZone.appendChild(buildCardElement(c)));
    });

    renderStats();
  }

  function buildColumnElement(col) {
    const node = columnTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.columnId = col.id;
    node.querySelector(".column-title").textContent = col.title;

    const prioSelect = node.querySelector(".prio-select");
    setupPrioritySelect(prioSelect);

    const form = node.querySelector(".add-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const input = form.querySelector(".add-input");
      const prio = prioSelect.dataset.value;
      addCard(col.id, input.value, prio);
      input.value = "";
      input.focus();
    });

    const dropzone = node.querySelector(".cards");
    setupDropzone(dropzone, col.id);

    return node;
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
        render();
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
  renderProjects();
  render();
})();
