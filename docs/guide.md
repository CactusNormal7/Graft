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
   - **☰ / {} / 📊** cycle la vue du résultat entre **table**, **json** et
     **chart** :
     - **json** — un **arbre JSON interactif** (repli/dépli par nœud, comme un
       éditeur JSON, avec **▼ all / ▶ all**). Quand une relation `JOIN` est
       détectée, les lignes sont **ré-imbriquées** en document relationnel
       (objet parent + tableau d'enfants — ex. un `user` contenant ses
       `reviews`) ; sinon c'est le tableau plat des objets `{ colonne: valeur }`.
       Colorisé par type (clé, chaîne, nombre, booléen, null).
     - **chart** — trace le résultat : choisis le **type** (bar / line / area /
       pie), la colonne **X** et une ou plusieurs séries **Y** (les colonnes
       numériques proposées en pastilles). La config est persistée dans le
       `.graft`. Palette catégorielle validée (accessibilité daltonisme).

     Clic droit sur le bouton (ou sur le bloc) pour choisir directement la vue.
   - **Pagination** : au-delà de **100 lignes** (ou 100 groupes en vue nested),
     une barre de pagination apparaît en pied de résultat (‹ / ›, plage
     affichée, sélecteur **50 / 100 / 500 / Tout**). Purement côté client.
   - **⇥** route le résultat vers un **bloc lié** (créé à droite au premier
     Run, connecté par une arête). Utile quand le résultat prend beaucoup
     de place ou qu'on veut le comparer à côté.
   - **▾ / ▸** replie le bloc sur son **header** (badge, nom renommable et
     bouton Run uniquement) — pratique pour dégager le canvas. Aussi dans le
     menu contextuel.
   - **⧉** duplique le bloc à côté.
   - **✕** supprime le bloc (et son bloc résultat lié, le cas échéant).
   - **Clic droit sur le bloc** ouvre un menu contextuel (Run, Duplicate,
     Rename, Copy SQL, changement de vue, toggle bloc-lié, Delete).
   - **Clic droit sur une cellule ou une ligne** de résultat : copies
     (valeur, colonne, ligne en JSON/INSERT/TSV) et snippets SQL (clause
     `WHERE`, `SELECT` filtré, template `UPDATE`).
   - **Redimensionnement** : sélectionne un bloc, les poignées apparaissent
     sur les bords/coins ; taille persistée dans le fichier `.graft`.
4. **Sidebar — explorateur de schéma** : les tables de la base connectée
   apparaissent en direct ; clique **▸** pour dérouler les colonnes ; tape
   dans **Search…** pour filtrer (tables + colonnes) — les tables dont une
   colonne matche se déploient automatiquement. **↻** relance l'introspection.
   **Double-clic sur un nom de table** crée automatiquement un bloc
   `SELECT * FROM <table> LIMIT 100;` sur le canvas et l'exécute aussitôt.
   **Double-clic sur une colonne** insère `table.colonne` au curseur du bloc
   actif (le dernier éditeur focalisé — surligné dans la liste « Blocks »).
5. **+ Group** (toolbar) crée un **conteneur coloré**. Fais glisser des blocs
   à l'intérieur pour les y attacher : déplacer le groupe déplace alors tous ses
   blocs. Sors un bloc du cadre pour le détacher. Le header du groupe permet de
   **renommer** (double-clic), **changer la couleur** (pastille) et **supprimer**
   le groupe (✕ — les blocs contenus sont conservés, seulement détachés).
   *(Suppression au clavier désactivée : utilise les boutons ✕ des blocs/groupes
   pour que les cascades — bloc résultat lié, détachement — s'exécutent.)*
6. **▶ Run all** (toolbar) exécute tous les blocs dans l'ordre.
7. **Déplace** les blocs librement, **relie-les** en tirant depuis le point de
   connexion droit vers le point gauche d'un autre bloc.
8. **Pages (onglets type Excel)** : la barre en bas du canvas liste les pages,
   chacune avec son propre canvas de blocs/groupes. **Clic** pour changer de
   page, **double-clic** pour renommer, **clic droit** pour supprimer, **+**
   pour en ajouter. Toutes les pages sont enregistrées dans le même `.graft`.
9. **Save** → enregistre le projet (toutes les pages) dans un fichier `.graft`
   (JSON). Le clic sur **graft** (en haut à gauche) revient à l'accueil.
10. Zoom via la toolbar (`−` / `+` / `⊞` pour ajuster) ou la molette ; **minimap**
   en bas à droite.

### Blocs favoris & sous-requêtes (`{{nom}}`)
- **Enregistrer un favori** : clic droit sur un bloc → **« Save as favorite… »**,
  puis choisis un nom. Les favoris sont listés dans la sidebar et enregistrés
  dans le `.graft`.
- **Réutiliser un favori dans une requête** : écris `{{nom}}` là où tu veux une
  sous-requête. À l'exécution, la référence est remplacée par le SQL du favori
  **entre parenthèses** :
  ```sql
  SELECT * FROM {{recent_users}} WHERE country = 'FR'
  ```
  Les favoris peuvent en référencer d'autres (imbrication) ; les références
  inconnues ou cycliques sont laissées telles quelles.
- **Insérer une référence** : double-clic sur le favori dans la sidebar (insère
  `{{nom}}` dans le bloc focalisé), ou double-clic sans bloc focalisé pour
  ouvrir le favori comme nouveau bloc.
- **⌘K / Ctrl+K** ouvre la **barre d'actions** : recherche parmi les favoris,
  ↑/↓ pour naviguer, ↵ pour insérer la référence dans le bloc focalisé (ou créer
  un bloc si aucun n'est focalisé).

### Données imbriquées ↔ INSERT multi-tables (ORM)
Une requête avec jointures donne une vue imbriquée (`{}`) — et cette vue est une
**vraie source de données** : tu peux la réinjecter sous forme d'INSERT.

- **Clic droit sur un bloc (ou son bloc résultat)** :
  - **Generate INSERTs → new block** — crée un bloc `script` contenant les
    INSERT. Si la relation est détectée, ce sont des INSERT **multi-tables** :
    un INSERT parent suivi de ses enfants, la clé étrangère étant renseignée
    automatiquement (valeur de la PK si présente, sinon `last_insert_rowid()`).
  - **Copy INSERTs** — la même chose dans le presse-papiers.
  - **Export INSERTs (.sql)…** — écrit un fichier `.sql`.
- **Import…** (toolbar) :
  - un **`.json` imbriqué** (ex. un `user` contenant ses `reviews`) est converti
    en INSERT multi-tables, relations comprises ;
  - un **`.sql`** est chargé tel quel dans un bloc pour relecture/exécution.

Les tables sont devinées à partir du **schéma en cache** (colonnes + clés
étrangères). Chaque script généré commence par des commentaires expliquant le
mapping choisi, les colonnes ignorées et les FK manquantes — vérifie-les avant
d'exécuter.

### Navigation sur le canvas
- **Déplacer la vue** : glisser le fond, ou **deux doigts au trackpad** (scroll).
- **Zoom** : **pincement** (trackpad), ou les contrôles en bas à gauche.
- **Scroll dans un bloc** (éditeur ou résultats) : **sélectionne d'abord le bloc**
  (clic) — sinon le geste déplace le canvas. Ainsi survoler un bloc n'empêche
  jamais de se déplacer, **ni de zoomer** (le pincement fonctionne partout, y
  compris au-dessus d'un bloc sélectionné).
- **Redimensionner** : approche le curseur d'un bord/coin de bloc ou de groupe —
  le curseur change (pas de poignées visibles).
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
