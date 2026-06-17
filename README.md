# Flow — Kanban de gestion de tâches

**Flow** est une application Kanban légère et entièrement fonctionnelle, écrite en
**JavaScript vanilla** (aucun framework, aucune étape de build, aucun CDN). C'est un
site statique pur : il suffit d'ouvrir `index.html` dans un navigateur.

## Fonctionnalités

- **4 colonnes Kanban** : À faire, En cours, En revue, Terminé.
- **Glisser-déposer** des cartes entre colonnes (HTML5 Drag & Drop API) avec
  retour visuel : colonne survolée mise en évidence, carte en cours de drag stylée,
  et insertion à la bonne position selon le curseur.
- **Ajout** d'une tâche via le champ + bouton de chaque colonne, avec
  choix de **priorité** (basse / moyenne / haute) matérialisée par une pastille
  et une bordure de couleur.
- **Suppression** d'une carte (bouton ×) et **édition en place** du texte
  (bouton ✎, validation par Entrée, annulation par Échap).
- **Statistiques d'avancement** : nombre de tâches par colonne, total, et une
  **barre de progression** indiquant le pourcentage de tâches « Terminé ».
- **Persistance locale** : tout l'état est sauvegardé dans `localStorage` et
  rechargé au démarrage. L'application survit à un rafraîchissement de page.

## Utilisation

Option 1 — ouvrir directement le fichier :

```
Ouvrir index.html dans votre navigateur (double-clic).
```

Option 2 — servir le dossier (recommandé, évite certaines restrictions) :

```bash
# Python
python3 -m http.server 8000
# puis ouvrir http://localhost:8000

# ou Node
npx serve .
```

## Structure du projet

```
Flow/
├── index.html   # structure + modèles (templates) de colonne et de carte
├── styles.css   # thème moderne, variables CSS, responsive, transitions
├── app.js       # logique : état, persistance, rendu, drag & drop
├── README.md
└── .gitignore
```

## Détails techniques

- **Séparation état / rendu** : `state` est la source de vérité ; les fonctions
  `render*()` ne font que lire l'état, les actions (`addCard`, `deleteCard`,
  `editCard`, `moveCard`) modifient l'état puis sauvegardent et re-rendent.
- **IDs uniques** générés par carte (`uid()`).
- **Sécurité** : le texte saisi par l'utilisateur est inséré via `textContent`
  (jamais `innerHTML`), ce qui empêche toute injection HTML/XSS.
- **Responsive** : les colonnes défilent horizontalement sur grand écran et
  passent en pile verticale sur mobile.
