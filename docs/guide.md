# Graft — Guide d'utilisation

> Document vivant. À mettre à jour dès que l'installation ou l'usage change
> (voir la règle dans `CLAUDE.md`).
> Dernière mise à jour : v0.1 (POC).

## 1. Prérequis (une seule fois)

- **Node.js** + **pnpm** — https://pnpm.io
- **Rust** (stable) — https://www.rust-lang.org/tools/install
- Les **prérequis Tauri** de ton OS — https://tauri.app/start/prerequisites/

## 2. Installation

```bash
pnpm install
```

## 3. Lancer l'application

```bash
pnpm tauri dev
```

Cette commande fait tout :
1. démarre le frontend (Vite) sur `localhost:1420` ;
2. compile le backend Rust — **long au premier lancement** (quelques minutes),
   quasi instantané ensuite ;
3. ouvre la fenêtre desktop **Graft**.

Le rechargement à chaud est actif : une modif dans `src/` se recharge
immédiatement ; une modif dans `src-tauri/` recompile le Rust.

> **`command not found: cargo` ?** La session ne voit pas Rust. Lance
> `source "$HOME/.cargo/env"` puis relance, ou ouvre un nouveau terminal.

## 4. Utiliser Graft

### Écran d'accueil
Au lancement, Graft affiche l'**accueil** : créer un projet ou rouvrir un récent.

- **+ New project** → ouvre une **modale** :
  - **Nom** du projet,
  - **Emplacement** (par défaut `~/Documents/Graft`, modifiable + *Browse*),
  - **Type de base** (SQLite ; PostgreSQL/MySQL arrivent en v0.3).
  - **Database file (SQLite)** : *Browse* pour pointer un fichier `.db`/`.sqlite`
    **existant** (ex. `data/sample.db`), ou laisse vide pour créer un nouveau
    `<nom>.db` à côté du projet.
  À la validation, le projet est **créé et sauvegardé immédiatement**
  (`<emplacement>/<nom>.graft`), puis tu entres dans le canvas.
- **Projets récents** → liste persistée ; clique pour **rouvrir**, ✕ pour retirer
  de la liste.
- **Open file…** → ouvre un `.graft` existant où qu'il soit.

> Seul **SQLite** est fonctionnel en v0.1 (multi-moteur en v0.3).

> 💡 Base d'exemple fournie : **`data/sample.db`** (tables `users`, `orders`,
> `products` avec des données). Tu peux créer un projet pointant dessus, ou pointer
> un nouveau projet vers ce fichier.

### Le canvas
1. **+ Block** (toolbar) → choisis un type (`query`, `migration`, `procedure`,
   `trigger`, `view`, `script`). Le bloc apparaît sur le canvas.
2. Écris ton SQL dans le bloc — coloration syntaxique, **numéros de ligne**,
   **surlignage de ligne active**, **appariement de parenthèses**, indentation
   automatique, **autocomplétion** ouverte à la frappe (tables/colonnes de ta
   base + mots-clés SQL en majuscules), puis exécute :
   - clique **▶**, ou
   - **Ctrl/Cmd + Entrée** quand le curseur est dans le bloc.
   Résultats :
   - Une requête de lecture affiche une **table de résultats** (+ nb de lignes
     et temps en ms), avec **numéros de ligne** et **double-clic sur une
     cellule pour la copier**.
   - Une écriture/DDL affiche le **nombre de lignes affectées**.
   - Une erreur s'affiche en rouge dans le bloc.
3. **Actions par bloc** dans le header :
   - **Double-clic sur le titre** → renommer (Entrée pour valider, Échap pour
     annuler).
   - **⧉** duplique le bloc à côté.
   - **✕** supprime le bloc (et ses connexions).
4. **Sidebar — explorateur de schéma** : les tables de la base connectée
   apparaissent en direct ; clique **▸** pour dérouler les colonnes ; tape
   dans **Search…** pour filtrer (tables + colonnes) — les tables dont une
   colonne matche se déploient automatiquement. **↻** relance l'introspection.
   **Double-clic sur un nom de table** ou de colonne l'insère au curseur du
   bloc actif (le dernier éditeur focalisé — surligné dans la liste
   « Blocks »).
5. **▶ Run all** (toolbar) exécute tous les blocs dans l'ordre.
6. **Déplace** les blocs librement, **relie-les** en tirant depuis le point de
   connexion droit vers le point gauche d'un autre bloc.
7. **Save** → enregistre le canvas dans un fichier `.graft` (JSON).
   Le clic sur **graft** (en haut à gauche) revient à l'accueil.
8. Zoom via la toolbar (`−` / `+` / `⊞` pour ajuster) ou la molette ; **minimap**
   en bas à droite.

### Navigation sur le canvas
- **Déplacer la vue** : glisser le fond.
- **Zoom** : molette, ou les contrôles en bas à gauche.
- **Minimap** : en bas à droite (cliquable/zoomable).

## 5. Construire un binaire distribuable

```bash
pnpm tauri build
```

Génère l'exécutable/installeur dans `src-tauri/target/release/` (et le bundle
`.app`/`.dmg` sur macOS).

## 6. Limites actuelles (v0.1)

- Éditeur SQL déjà bien avancé (CodeMirror 6 : coloration + autocomplétion
  schéma + gutter + brackets + `Mod-Enter`) — reste à faire côté v0.2+ : LSP
  (`sql-language-server`), diagnostics en ligne, formatage, palette ⌘K.
- Seul **SQLite** est supporté (Postgres/MySQL en v0.3).
- Les liens entre blocs sont visuels uniquement (pas encore d'ordre
  d'exécution).
