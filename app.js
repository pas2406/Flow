/* ============================================================
   Flow — application Kanban (JavaScript vanilla, sans framework)

   Architecture :
     - state        : source de vérité (colonnes + cartes), chargée/sauvée
                      dans localStorage.
     - render*()    : reconstruisent le DOM à partir de l'état.
     - actions      : modifient l'état puis appellent save() + render().

   Séparation stricte rendu / état : aucune fonction de rendu ne modifie
   l'état, aucune action ne touche directement au DOM des cartes.
   ============================================================ */

(function () {
  "use strict";

  // ---------- Constantes ----------
  const STORAGE_KEY = "flow.kanban.v1";

  // Définition des colonnes (id stable + libellé affiché).
  const COLUMNS = [
    { id: "todo",   title: "À faire" },
    { id: "doing",  title: "En cours" },
    { id: "review", title: "En revue" },
    { id: "done",   title: "Terminé" },
  ];

  // Colonne considérée comme "achevée" pour la barre de progression.
  const DONE_COLUMN = "done";

  // ---------- État ----------
  // state.cards : tableau ordonné de { id, text, priority, columnId }
  let state = { cards: [] };

  // ---------- Références DOM ----------
  const board = document.getElementById("board");
  const columnTemplate = document.getElementById("column-template");
  const cardTemplate = document.getElementById("card-template");
  const progressFill = document.getElementById("progress-fill");
  const progressLabel = document.getElementById("progress-label");

  // ============================================================
  //  Persistance (localStorage)
  // ============================================================
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.cards)) {
        // On ne garde que les cartes dont la colonne existe encore.
        const validIds = new Set(COLUMNS.map((c) => c.id));
        state.cards = parsed.cards
          .filter((c) => c && typeof c.id === "string" && validIds.has(c.columnId))
          .map((c) => ({
            id: c.id,
            text: String(c.text || ""),
            priority: ["low", "medium", "high"].includes(c.priority) ? c.priority : "medium",
            columnId: c.columnId,
          }));
      }
    } catch (err) {
      // En cas de données corrompues, on repart d'un état vide.
      console.warn("Flow : impossible de charger l'état, réinitialisation.", err);
      state = { cards: [] };
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("Flow : impossible de sauvegarder l'état.", err);
    }
  }

  // ============================================================
  //  Utilitaires
  // ============================================================

  // Génère un identifiant unique pour une carte.
  function uid() {
    return "c_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  // Échappement du texte utilisateur : on n'insère JAMAIS de HTML brut.
  // (Ici on utilise textContent côté rendu, mais cette fonction reste
  //  disponible si besoin d'injecter dans un attribut/markup.)
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function getCard(id) {
    return state.cards.find((c) => c.id === id) || null;
  }

  // ============================================================
  //  Actions (modifient l'état)
  // ============================================================
  function addCard(columnId, text, priority) {
    const clean = text.trim();
    if (!clean) return;
    state.cards.push({
      id: uid(),
      text: clean,
      priority: priority || "medium",
      columnId: columnId,
    });
    save();
    render();
  }

  function deleteCard(id) {
    state.cards = state.cards.filter((c) => c.id !== id);
    save();
    render();
  }

  function editCard(id, newText) {
    const card = getCard(id);
    if (!card) return;
    const clean = newText.trim();
    if (!clean) {
      // Texte vidé => on supprime la carte.
      deleteCard(id);
      return;
    }
    card.text = clean;
    save();
    render();
  }

  // Déplace une carte vers une colonne, en l'insérant avant `beforeId`
  // (ou à la fin si beforeId est null).
  function moveCard(id, targetColumnId, beforeId) {
    const idx = state.cards.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const [card] = state.cards.splice(idx, 1);
    card.columnId = targetColumnId;

    if (beforeId) {
      const beforeIdx = state.cards.findIndex((c) => c.id === beforeId);
      if (beforeIdx !== -1) {
        state.cards.splice(beforeIdx, 0, card);
        save();
        render();
        return;
      }
    }
    state.cards.push(card);
    save();
    render();
  }

  // ============================================================
  //  Rendu (lecture seule de l'état)
  // ============================================================

  // Construit une carte DOM à partir d'un objet carte.
  function buildCardElement(card) {
    const node = cardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.cardId = card.id;
    node.dataset.priority = card.priority;
    // Texte via textContent => pas d'injection HTML possible.
    node.querySelector(".card-text").textContent = card.text;
    return node;
  }

  // Met à jour l'en-tête : compteurs par colonne + total + progression.
  function renderStats() {
    const counts = { total: state.cards.length };
    COLUMNS.forEach((col) => {
      counts[col.id] = state.cards.filter((c) => c.columnId === col.id).length;
    });

    document.querySelectorAll("[data-stat]").forEach((el) => {
      const key = el.getAttribute("data-stat");
      el.textContent = counts[key] != null ? counts[key] : 0;
    });

    const done = counts[DONE_COLUMN] || 0;
    const pct = counts.total > 0 ? Math.round((done / counts.total) * 100) : 0;
    progressFill.style.width = pct + "%";
    progressLabel.textContent = pct + "%";

    // Met aussi à jour les compteurs dans les en-têtes de colonnes.
    COLUMNS.forEach((col) => {
      const section = board.querySelector('[data-column-id="' + col.id + '"]');
      if (section) section.querySelector(".column-count").textContent = counts[col.id];
    });
  }

  // Rendu complet du board.
  function render() {
    // (Re)construit les colonnes seulement si elles n'existent pas encore.
    if (!board.children.length) {
      COLUMNS.forEach((col) => board.appendChild(buildColumnElement(col)));
    }

    // Remplit chaque zone de cartes.
    COLUMNS.forEach((col) => {
      const section = board.querySelector('[data-column-id="' + col.id + '"]');
      const cardsZone = section.querySelector(".cards");
      cardsZone.innerHTML = "";
      state.cards
        .filter((c) => c.columnId === col.id)
        .forEach((c) => cardsZone.appendChild(buildCardElement(c)));
    });

    renderStats();
  }

  // Construit une colonne DOM (en-tête + zone de drop + formulaire).
  function buildColumnElement(col) {
    const node = columnTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.columnId = col.id;
    node.querySelector(".column-title").textContent = col.title;

    // --- Formulaire d'ajout ---
    const form = node.querySelector(".add-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const input = form.querySelector(".add-input");
      const prio = form.querySelector(".add-priority").value;
      addCard(col.id, input.value, prio);
      input.value = "";
      input.focus();
    });

    // --- Drag & drop : la zone de cartes est la zone de dépôt ---
    const dropzone = node.querySelector(".cards");
    setupDropzone(dropzone, col.id);

    return node;
  }

  // ============================================================
  //  Glisser-déposer (HTML5 Drag & Drop API)
  // ============================================================
  let draggedId = null;

  // Détermine la carte avant laquelle insérer, selon la position Y du curseur.
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
    return closest.element; // null => insérer à la fin
  }

  function setupDropzone(dropzone, columnId) {
    dropzone.addEventListener("dragover", function (e) {
      e.preventDefault(); // autorise le drop
      e.dataTransfer.dropEffect = "move";
      dropzone.classList.add("drag-over");
    });

    dropzone.addEventListener("dragleave", function (e) {
      // Ne retire le surlignage que si on quitte réellement la zone.
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

  // Délégation des événements de drag au niveau du board (les cartes sont
  // recréées à chaque rendu, donc on évite d'attacher des listeners individuels).
  board.addEventListener("dragstart", function (e) {
    const card = e.target.closest(".card");
    if (!card) return;
    draggedId = card.dataset.cardId;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    // Certains navigateurs exigent une donnée pour démarrer le drag.
    try { e.dataTransfer.setData("text/plain", draggedId); } catch (_) {}
  });

  board.addEventListener("dragend", function (e) {
    const card = e.target.closest(".card");
    if (card) card.classList.remove("dragging");
    draggedId = null;
    document.querySelectorAll(".cards.drag-over").forEach((z) => z.classList.remove("drag-over"));
  });

  // ============================================================
  //  Interactions cartes (suppression / édition) — délégation
  // ============================================================
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

  // Édition en place : on rend le paragraphe éditable, et on enregistre
  // au blur ou à la touche Entrée.
  function startEditing(cardEl, id) {
    const p = cardEl.querySelector(".card-text");
    cardEl.setAttribute("draggable", "false"); // évite les conflits drag/édition
    p.setAttribute("contenteditable", "true");
    p.focus();

    // Place le curseur à la fin du texte.
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
        editCard(id, p.textContent); // render() reconstruit la carte
      } else {
        render(); // restaure le texte d'origine
      }
    }

    function onBlur() { finish(true); }
    function onKey(ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        p.blur(); // déclenche onBlur => sauvegarde
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
    }

    p.addEventListener("blur", onBlur);
    p.addEventListener("keydown", onKey);
  }

  // ============================================================
  //  Démarrage
  // ============================================================
  load();
  render();
})();
