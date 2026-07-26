# Graft — Explication technique

> Document vivant. À mettre à jour à chaque changement d'architecture, de stack,
> d'arborescence ou de build (voir la règle dans `CLAUDE.md`).
> Dernière mise à jour : v0.1 (POC).

## Stack (décidée)

| Couche | Choix | Pourquoi (résumé) |
|--------|-------|-------------------|
| Shell | **Tauri 2** (Rust) | binaires légers vs Electron, drivers DB natifs en Rust |
| Frontend | **React 19 + TypeScript + Vite** | intégration officielle Tauri, pas de besoins SSR |
| Canvas | **React Flow** (`@xyflow/react`) | vrai modèle nœuds/arêtes pour les connexions blocs ↔ schéma |
| Éditeur SQL | **CodeMirror 6** (`@uiw/react-codemirror` + `@codemirror/lang-sql`) | léger pour N éditeurs sur le canvas ; coloration + autocomplétion schéma natives (préféré à Monaco) |
| État | **Zustand** | évite les re-renders en cascade du Context API |
| Graphiques | **Recharts** (`recharts`) | vue `chart` des résultats (bar/line/area/pie), déclaratif React ; compromis : plus lourd que uPlot/visx, à réévaluer si perf |
| Drivers DB | **sqlx** — **Postgres + MySQL + SQLite** | API async unifiée multi-moteur |

> Ne pas proposer d'alternative à la stack sans signaler explicitement le compromis.

### Support multi-moteur (exigence forte)

**Postgres, MySQL et SQLite sont les trois moteurs absolument indispensables** —
SQLite seul (v0.1) n'est qu'un point de départ. `sqlx` est précisément choisi pour
ça : une seule API async couvre les trois via des features de compilation
(`postgres`, `mysql`, `sqlite`). Conséquences d'archi à anticiper dès maintenant :

- le moteur devient une **dimension de la connexion** (type + chaîne de
  connexion), plus un simple chemin de fichier comme en v0.1 ;
- la commande d'exécution doit router vers le bon pool selon le moteur ;
- le mapping des types et les spécificités de dialecte (DDL, procédures,
  `RETURNING`, etc.) diffèrent par moteur — à abstraire proprement.

L'ambition « complète » (cf. `docs/conceptuel.md` § Ambition) implique aussi un
**gestionnaire de connexions** (créer/éditer/sauver des connexions nommées,
secrets) plutôt que la sélection de fichier ad hoc actuelle.

### Plateformes cibles

Graft vise **macOS** et **Windows** comme plateformes de distribution. Ce sont
les deux seuls OS pour lesquels le rendu, les menus, les dialogues et le bundle
doivent être polis. **Linux n'est pas une cible** : Tauri sait le compiler et
ça peut fonctionner comme sous-produit, mais aucune décision d'architecture ne
doit dégrader l'expérience macOS/Windows pour améliorer Linux.

**WSL2 = environnement de dev, pas plateforme cible.** En WSL2, la fenêtre
Tauri est un binaire Linux affiché sur Windows via WSLg → décors GTK peu
esthétiques (barre grise), boîtes de dialogue GTK, pas de menu bar native. Ce
rendu **n'est pas représentatif** du build Windows natif : pour voir la vraie
UI Windows, il faut compiler et lancer depuis Windows directement (PowerShell,
Rust+Node côté Windows), pas depuis WSL. Le build macOS suit la même logique
sur un Mac.

### Coquille applicative (app shell)

Graft cible une **application desktop classique**, pas un canvas plein écran :

- **Barre latérale (sidebar)** : connexions, explorateur de schéma, navigation
  entre notebooks/vues.
- **Barre de menus native** (Fichier, Édition, Affichage, Fenêtre…) via l'**API
  Menu de Tauri**, rendue nativement sur **macOS** (menu bar système) et
  **Windows** (menu de fenêtre).
- **Canvas** comme surface centrale parmi d'autres (console SQL, grille de
  données, diagrammes…), pas comme l'application entière.
- **Décors de fenêtre** : natifs par défaut (Fluent sur Windows, traffic-light
  sur macOS). Une **barre de titre custom cross-platform** intégrant menus et
  onglets (style VS Code / DataGrip) reste ouverte pour v0.2+.

> Le squelette v0.1 minimal a été **revu** : la coquille (toolbar + sidebar +
> canvas + status bar) et l'écran d'accueil sont implémentés d'après le wireframe
> Claude Design (cf. § Design system).

### Design system

Le design system vit dans **Claude Design** (projet « Wireframe application
design », design system `graft-design-system`) et est **miroité** dans le repo :

- **Tokens** : `src/styles/tokens/*.css` (colors, typography, spacing, elevation,
  blocks, data), thèmes **dark** (défaut) **et light** via l'attribut
  `[data-theme]` sur `<html>`. Densité **compact**/**comfortable** via
  `[data-density]`. Les deux attributs sont posés dans `main.tsx`.
- **Composants/coquille** : `src/styles/app.css` traduit les styles inline du
  wireframe en classes (`.toolbar`, `.sidebar`, `.statusbar`, `.card`,
  `.btn`/`.btn-accent`, `.badge--<type>`, `.dot-grid`, `.sql-block`,
  `.result-table`, etc.) bâties sur les tokens.
- **Police** : **JetBrains Mono** appliquée partout (parti pris « terminal/dev »
  du wireframe), **bundlée via `@fontsource/jetbrains-mono`** (400/500/600/700)
  — pas de Google Fonts au runtime, l'app doit marcher hors-ligne.
- **Synchronisation** : accès via le MCP `claude_design` (skill `/design-sync`).
  Toute évolution du DS dans Claude Design doit être répercutée dans
  `src/styles/tokens/`. Détails et lien projet en mémoire (`design-system`).

> Le wireframe décrit aussi des éléments **pas encore fonctionnels** rendus en
> placeholder : explorateur de schéma (introspection v0.3), connexions
> Postgres/MySQL (v0.3), graphiques, palette de commandes ⌘K, minimap riche.

## Arborescence

```
Graft/
├── index.html                # point d'entrée Vite
├── package.json              # scripts + deps frontend
├── vite.config.ts            # config Vite (port fixe 1420 pour Tauri)
├── tsconfig.json
├── docs/                     # documentation vivante (ce dossier)
├── src/                      # frontend React
│   ├── main.tsx              # bootstrap : fonts + tokens + CSS React Flow + thème
│   ├── App.tsx               # routeur de vue (home / canvas) + coquille
│   ├── types.ts              # types domaine (BlockType, QueryResult, NotebookFile…)
│   ├── store/
│   │   └── useGraftStore.ts  # store Zustand (view, pages, nodes/edges de la page active, dbPath, actions)
│   ├── styles/
│   │   ├── app.css           # classes de la coquille + composants (issu du wireframe)
│   │   └── tokens/           # design tokens (miroir du DS Claude Design)
│   │       ├── colors.css    # surfaces, texte, accent, sémantiques (dark + light)
│   │       ├── typography.css# familles, échelle, graisses
│   │       ├── spacing.css   # grille 4px, hauteurs, rayons, densité
│   │       ├── elevation.css # ombres, focus ring, z-index
│   │       ├── blocks.css    # couleur par type de bloc
│   │       └── data.css      # couleurs grille de données (null, types, diff)
│   ├── screens/
│   │   └── HomeScreen.tsx    # écran d'accueil (connexions, quick connect, récents)
│   ├── components/
│   │   ├── Toolbar.tsx       # barre du haut : connexion, +Block, Run all, zoom
│   │   ├── Sidebar.tsx       # explorateur de schéma live (tables/colonnes, recherche, insertion) + liste des blocs
│   │   ├── SqlEditor.tsx     # CodeMirror 6 SQLite : coloration, autocomplete schéma, gutter, brackets, Mod-Enter
│   │   ├── PageTabs.tsx      # barre d'onglets de pages (Excel-like) en bas du canvas
│   │   └── StatusBar.tsx     # barre de statut bas
│   └── canvas/
│       ├── GraftCanvas.tsx   # <ReactFlow> + dot-grid + Controls/MiniMap + empty state + drag→groupe
│       ├── SqlBlockNode.tsx  # nœud custom : header (titre éditable, dupliquer, supprimer, Run), éditeur, résultats
│       ├── GroupNode.tsx     # nœud conteneur coloré (parent React Flow) : titre, couleur, resize
│       ├── editorRegistry.ts # registre id→EditorView pour insérer depuis la sidebar
│       └── ResultTable.tsx   # rendu d'un result set : vues table / json (arbre repliable) / chart + pagination client
└── src-tauri/                # backend Rust (Tauri)
    ├── Cargo.toml            # deps Rust (tauri, sqlx, tokio, plugins)
    ├── tauri.conf.json       # config app (fenêtre, bundle, identifier)
    ├── capabilities/default.json  # permissions (core, opener, dialog)
    └── src/
        ├── main.rs           # appelle graft_lib::run()
        ├── lib.rs            # Builder Tauri + enregistrement des commandes
        ├── db.rs             # moteur d'exécution SQLite (execute_sql)
        └── notebook.rs       # save/load .graft + default_project_dir / create_project_paths
```

## Flux de données

### Exécution d'une requête
1. L'utilisateur clique **▶ Run** sur un bloc → `runBlock(id)` dans le store.
2. Le store passe le bloc en `running` et appelle la commande Tauri
   `invoke("execute_sql", { dbPath, sql, maxRows: MAX_FETCH_ROWS })`.
3. Côté Rust (`db.rs`) : ouverture d'un `SqlitePool` sur `dbPath`
   (`create_if_missing`), exécution d'**un** statement :
   - statement qui renvoie des lignes (`select`/`with`/`pragma`/`explain`) →
     `fetch_all`, puis **`take(max_rows)`** avant la conversion de chaque cellule
     en `serde_json::Value` (sondage de types i64 → f64 → bool → String → blob) ;
   - sinon (`INSERT`/`UPDATE`/DDL…) → `execute`, on renvoie `rows_affected`.
4. Le résultat (`QueryResult { columns, rows, rows_affected, elapsed_ms,
   total_rows, truncated }`) revient au store, qui met le bloc en `success` (ou
   `error`) et déclenche le rendu inline (`ResultTable` ou message d'erreur).

**Plafond de lignes (perf)** — la conversion JSON + la sérialisation IPC de
Tauri sont le vrai coût d'un gros résultat (50 000 lignes × 19 colonnes ≈ 950 000
valeurs). `execute_sql` ne convertit donc que les `max_rows` premières lignes
(défaut **5000**, `MAX_FETCH_ROWS` côté store), tout en renvoyant le **vrai**
total (`total_rows`) et un drapeau `truncated` affiché dans le pied du bloc
(« 5000 / 50000 row(s) · tronqué »). L'UI pagine ensuite ces lignes (100/page).

### Projets (création / ouverture / sauvegarde)
Un **projet** = un fichier `.graft` + une connexion (type + base). Cycle de vie :

- **Créer** (`createProject(name, dir, dbType)`) : `create_project_paths` dérive
  `<dir>/<name>.graft` et `<dir>/<name>.db` (join natif cross-platform) ; le store
  passe en `canvas` avec un canevas vide, puis **écrit immédiatement le `.graft`**
  (`save_notebook`) → le projet est persisté dès sa création. La modale propose un
  emplacement par défaut (`default_project_dir` = `<Documents|Home>/Graft`) et un
  *Browse* (dialogue dossier).
- **Sauvegarder** (`saveNotebook()`) : écrit dans le `projectPath` courant **sans
  dialogue** (le projet a toujours un chemin). L'état d'exécution transitoire
  (status/result/error) est remis à zéro avant écriture → fichiers diff-friendly.
- **Ouvrir** : `openProjectByPath(path)` (clic sur un récent) ou
  `openProjectFromDialog()` (Open file…) lit le JSON via `load_notebook` et
  reconstruit `name`/`dbType`/`dbPath`/nodes/edges. Si le fichier est illisible,
  l'entrée est purgée des récents.

### Projets récents
Liste persistée dans **`localStorage`** (`graft.recentProjects`, max 12) :
`{ name, projectPath, dbType, dbPath, modifiedAt }`. Mise à jour (remontée en tête)
à chaque création / ouverture / sauvegarde. Affichée sur l'accueil, réouvrable au
clic, supprimable (✕).

### Éditeur SQL & autocomplétion
- **`src/components/SqlEditor.tsx`** : CodeMirror 6 (dialecte SQLite), coloration
  syntaxique, **numéros de ligne**, **active line**, **bracket matching** +
  auto-close, indentation à la volée, **autocomplétion** ouverte à la frappe
  (`activateOnTyping: true`, sources combinées `schemaCompletionSource` +
  `keywordCompletionSource`) et raccourci **`Mod-Enter` (Ctrl/Cmd+Entrée)** pour
  exécuter le bloc focalisé (keymap en `Prec.highest`).
- **Focus & registre** : chaque `SqlEditor` s'enregistre dans un module
  `src/canvas/editorRegistry.ts` (map `id → EditorView`) et remonte son focus
  au store (`focusedBlockId`). La sidebar utilise ce registre pour insérer un
  nom de **colonne** au curseur du bloc actif (double-clic colonne). Le
  **double-clic sur un nom de table** appelle plutôt `store.addSelectBlock(table)`
  qui crée et exécute un bloc `SELECT * FROM <table> LIMIT 100;`.
- **Schéma** : `store.schema` (`Record<table, colonnes[]>`) alimenté par la
  commande `introspect_schema`. Rafraîchi à la **création/ouverture** d'un projet
  et après un statement **DDL** réussi (`CREATE`/`ALTER`/`DROP`). Passé tel quel à
  `@codemirror/lang-sql` comme `schema` **et** rendu dans la sidebar
  (`Sidebar.tsx`) : arbre tables → colonnes, recherche (filtre sur noms de
  tables + colonnes), bouton **↻** de rafraîchissement manuel.
- Le nœud (`SqlBlockNode`) expose aussi **titre éditable** (double-clic),
  **dupliquer** (⧉), **supprimer** (✕) et **▶ Run** — le run est aussi
  déclenché par `Mod-Enter`.

## Commandes Tauri exposées (`lib.rs`)

| Commande | Signature | Rôle |
|----------|-----------|------|
| `execute_sql` | `(db_path: String, sql: String, max_rows: Option<usize>) -> Result<QueryResult, String>` | exécute un statement SQLite ; **plafonne** les lignes renvoyées (défaut 5000) |
| `introspect_schema` | `(db_path: String) -> Result<Vec<TableInfo>, String>` | structure SQLite : tables/vues, colonnes (type, notnull, pk) et **clés étrangères** |
| `save_notebook` | `(path: String, contents: String) -> Result<(), String>` | écrit un `.graft` |
| `load_notebook` | `(path: String) -> Result<String, String>` | lit un `.graft` |
| `path_exists` | `(path: String) -> bool` | teste l'existence d'un fichier (purge des récents) |
| `default_project_dir` | `() -> Result<String, String>` | dossier projet par défaut `<Documents\|Home>/Graft` (créé) |
| `create_project_paths` | `(dir, name) -> Result<{projectPath, dbPath}, String>` | dérive `.graft`/`.db` (join cross-platform) |

> Convention : `db_path`/`sql` côté Rust (snake_case) ↔ `dbPath`/`sql` côté JS
> (Tauri convertit automatiquement le camelCase en snake_case).

## Format de fichier `.graft`

Depuis la **version 4**, le fichier est **paginé** : `pages[]` (onglets type
Excel), chacune avec ses propres `nodes`/`edges`. Les fichiers v1–v3 (canvas plat
avec `nodes`/`edges` à la racine) restent lisibles et sont migrés en une page
unique « Page 1 » (`pagesFromFile`). Les nœuds ont la même forme qu'avant.

```jsonc
{
  "version": 4,                            // 1 pré-blocs liés · 2 blocs liés · 3 groupes+parentId · 4 pages (rétro-compatible en lecture)
  "name": "analytics",
  "dbType": "sqlite",                      // sqlite | postgres | mysql
  "dbPath": "/chemin/vers/base.sqlite",   // ou null
  "pages": [{ "id": "page-...", "name": "Page 1", "nodes": [
    {
      "id": "block-...",
      "type": "sqlBlock",                  // sqlBlock | resultBlock | group
      "position": { "x": 80, "y": 80 },
      "data": {
        "title": "Query 1",
        "blockType": "query",
        "sql": "SELECT 1;",
        "status": "idle",                  // toujours réinitialisé à la sauvegarde
        "result": null,
        "error": null,
        "resultView": "table",             // table | json | chart (défaut table ; anciens "records"/"nested" → "json")
        "chartConfig": {                   // config de la vue chart (persistée)
          "type": "bar",                   // bar | line | area | pie
          "xCol": "name",
          "yCols": ["total"]
        },
        "emitToBlock": false,              // si true : résultat routé vers un bloc lié
        "linkedResultId": null,            // id du bloc résultat lié (si spawn)
        "width": 360,                      // dimensions persistées (NodeResizer)
        "height": 240
      }
    },
    {
      "id": "block-result-...",
      "type": "resultBlock",               // compagnon en lecture seule
      "position": { "x": 500, "y": 80 },
      "data": {
        "sourceId": "block-...",
        "sourceTitle": "Query 1",
        "status": "idle",
        "result": null,
        "error": null,
        "resultView": "json",
        "width": 420,
        "height": 320
      }
    }
  ], "edges": [ { "id": "...", "source": "block-a", "target": "block-b" } ] }]
}
```

**Dimensions par défaut** — tout nœud reçoit une **largeur et une hauteur
explicites** à la création (bloc 520×300, bloc résultat 640×360, groupe
480×340), et un repli est appliqué au chargement des anciens fichiers. Sans
cela React Flow mesure le nœud d'après son contenu : une table à 19 colonnes ou
un script d'INSERT de plusieurs milliers de lignes produisait un bloc démesuré.
Le contenu **scrolle à l'intérieur** ; le bloc reste redimensionnable à la
souris. Les blocs repliés (`collapsed`) sont la seule exception (hauteur
laissée libre pour coller au header).

**Schéma en cache (v5)** — la structure de la base (`dbSchema: TableInfo[]` :
colonnes typées, PK, **clés étrangères**) est introspectée **à la création du
projet**, rafraîchie après chaque DDL réussi (`CREATE`/`ALTER`/`DROP`), et
**sérialisée dans le `.graft`**. Elle est donc disponible dès l'ouverture sans
tout re-déduire, et sert de base aux fonctionnalités relationnelles (ORM).
`store.schema` (`table → colonnes[]`) en est dérivé (`flattenSchema`) pour
l'autocomplétion CodeMirror et la sidebar.

**Blocs favoris / snippets (v5)** — `snippets: Snippet[]` (persistés dans le
`.graft`). Un favori est référencé par `{{nom}}` dans n'importe quelle requête ;
`expandSnippets` (`src/store/snippets.ts`) substitue la référence par le SQL du
favori **entre parenthèses** (donc utilisable en sous-requête), résout les
références imbriquées, et laisse intactes les références inconnues ou cycliques
(garde anti-boucle + profondeur max 10). L'expansion a lieu dans `runBlock`,
juste avant l'appel à `execute_sql` — le SQL affiché dans l'éditeur reste celui
écrit par l'utilisateur.

**Pont relationnel (ORM) — `src/canvas/orm.ts`** — la vue JSON/imbriquée est
traitée comme une **vraie source de données relationnelle**. Tout y est pur
(pas de React/store/Tauri), donc testable isolément :

- `matchTable(columns, schema)` — retrouve la table cible par recouvrement de
  noms de colonnes (seuil 60 %), en **excluant les vues** (pas d'INSERT dessus).
- `findForeignKey(child, parent)` — la FK reliant les deux tables, lue depuis le
  schéma en cache (`dbSchema`).
- `generateInserts(result, schema)` — si le résultat a une forme parent→enfants
  (`detectNestedShape`) **et** que les deux côtés correspondent à des tables
  réelles, sort des INSERT **relationnels** : un INSERT parent puis ses enfants,
  avec la FK renseignée (valeur explicite de la PK si elle est sélectionnée,
  sinon `last_insert_rowid()`). Sinon, repli sur des INSERT plats ligne à ligne,
  avec un placeholder `«table»` si aucune table ne correspond.
- `jsonToInserts(json, schema)` — l'inverse à l'import : les champs scalaires
  d'un objet deviennent une ligne, chaque tableau d'objets devient des lignes
  dans sa propre table, reliées par la FK. Récursif (profondeur max 10).
- Les avertissements (table devinée, colonnes ignorées, FK absente) sont émis en
  en-tête de commentaires SQL — la génération ne se fait jamais en silence.

Exposé par : menu contextuel d'un bloc/résultat (**Generate INSERTs → new
block**, **Copy INSERTs**, **Export INSERTs (.sql)…**) et bouton **Import…** de
la toolbar (`.json` imbriqué → INSERT multi-tables, `.sql` → chargé tel quel
dans un bloc `script`). E/S fichier via les commandes `write_text_file` /
`read_text_file`. Le formatage SQL (`quoteIdent`/`sqlLiteral`) est centralisé
dans `src/sqlFormat.ts`.

**Pages en mémoire** — le store garde `pages: Page[]` + `activePageId`, et
`nodes`/`edges` (top-level) = **copie de travail de la page active** (les
composants restent inchangés). `commitActivePage` resynchronise cette copie dans
`pages` avant chaque changement de page ou sauvegarde. Actions : `addPage`,
`renamePage`, `deletePage` (garde au moins une page), `switchPage`. Barre
d'onglets : `components/PageTabs.tsx`.

### Vues de résultat

Trois modes disponibles pour un bloc SQL (`normalizeResultView` mappe les
anciennes valeurs `records`/`nested` vers `json`) :

- **`table`** — feuille de calcul classique, avec numéros de ligne.
- **`json`** — un **arbre JSON interactif** (`JsonTreeView` dans
  `ResultTable.tsx`) : chaque objet/tableau est repliable (comme un éditeur
  JSON), avec **▼ all / ▶ all** et un défaut d'ouverture par profondeur.
  Les données affichées sont **soit** le document relationnel ré-imbriqué quand
  `detectNestedShape` trouve une relation `JOIN` (objet parent + tableau
  d'enfants via `buildNestedGroups`/`groupToObject`), **soit** le tableau plat
  des objets ligne. Colorisé par type.
- **`chart`** — trace le résultat via **Recharts** (`ChartView` dans
  `ResultTable.tsx`) : type `bar`/`line`/`area`/`pie`, une colonne X, une ou
  plusieurs séries Y (colonnes numériques détectées par `numericColumns()`).
  La config (`ChartConfig`) est persistée sur le bloc (`store.setChartConfig`).
  Les couleurs viennent des tokens `--chart-1..8` (palette catégorielle validée
  CVD via le skill dataviz, déclinée clair/sombre), lus au rendu pour suivre le
  thème. La vue chart ignore la pagination (elle trace tout le résultat).

**Ré-imbrication (vue `json`)** — `detectNestedShape` reconstruit un document
relationnel à partir des lignes plates d'un `JOIN` par **détection automatique**,
sans convention d'alias. L'heuristique parcourt les colonnes de gauche à droite :
une colonne reste « parent » tant qu'elle est constante dans chaque groupe défini
par les parents déjà choisis ; dès qu'une colonne varie, elle (et celles à sa
droite) deviennent des colonnes d'enfants. Les lignes ne différant que sur ces
colonnes fusionnent dans le même parent (`buildNestedGroups`), et `groupToObject`
produit `{ …parent, <label>: [ …enfants ] }`. Le libellé enfant est deviné d'un
préfixe commun (`constat_id`/`constat_title` → `constat`) ; à défaut, `items`.
Ex. `SELECT * FROM users LEFT JOIN reviews …` → un objet `user` contenant son
tableau de reviews. Sans rien à regrouper (lignes uniques), la vue json affiche
le tableau plat des objets ligne.

**Pagination** — les vues `table` et `json` paginent **côté client** (les lignes
sont déjà toutes dans le store). État local à `ResultTable` : `page` + `pageSize`
(défaut **100**, réinitialisés quand le résultat / la vue / la taille change).
`table` pagine les **lignes**, `json` les **éléments** de premier niveau (objets
ré-imbriqués ou lignes plates). La barre (‹ / ›, plage, sélecteur 50 / 100 / 500 /
Tout) n'apparaît qu'au-delà de 100. `chart` trace tout le résultat (pas de page).

Structure du rendu : `.sql-block__result` (colonne flex, **sans** scroll) →
`.result-view` → `.result-view__body` (**le** conteneur scrollable) puis
`.result-pager`. La barre de pagination est donc un frère de la zone scrollable,
pas un enfant : elle reste toujours la dernière ligne du bloc et ne peut pas
flotter par-dessus les données (un `position: sticky` s'y comportait mal dans ce
contexte flex imbriqué).

### Bloc résultat lié (`resultBlock`)

Quand `emitToBlock: true` sur un bloc SQL, l'exécution ne remplit plus le
pied du bloc source mais spawne (première fois) ou met à jour un
`resultBlock` positionné à droite et relié par une arête. Le
`resultBlock` est en lecture seule, expose le même sélecteur de vue, et
sa suppression déclenche automatiquement l'unlink côté source.

### Groupes conteneurs (`group`)

Un nœud `group` (`GroupNode.tsx`, data `GroupBlockData { title, color }`) est un
**cadre coloré** utilisant le **parentage natif de React Flow** :

- Les groupes sont maintenus **en tête du tableau `nodes`** (`sortGroupsFirst`) —
  React Flow impose qu'un parent précède ses enfants, et cela les rend *derrière*
  les blocs.
- Sur `onNodeDragStop` (`GraftCanvas.tsx`), on détecte le groupe survolé via
  `getIntersectingNodes` : le bloc reçoit (ou perd) un `parentId`, et sa position
  est convertie entre **absolu** et **relatif au parent** (via
  `getInternalNode(id).internals.positionAbsolute`). `store.reparentNode` applique
  le changement. Déplacer un groupe déplace nativement ses enfants.
- `store.deleteGroup` supprime le cadre mais **conserve les blocs** (détachés :
  `parentId` retiré, position reconvertie en absolu).
- La **suppression clavier est désactivée** (`deleteKeyCode={null}`) pour que
  toutes les suppressions passent par les boutons ✕ (cascades : résultat lié,
  détachement des enfants).
- Persistance : chaque nœud sérialise `parentId` (si présent) ; format `.graft`
  **version 3**. Les fichiers v1/v2 restent lisibles (pas de groupe, pas de
  `parentId`).

## Prérequis & commandes

**Prérequis :** Node + pnpm, Rust stable (+ prérequis Tauri de l'OS).

**Cibles de build :**
- **macOS** : builder depuis un Mac (`pnpm tauri build` → `.app` + `.dmg`).
- **Windows** : builder depuis Windows natif (`pnpm tauri build` → `.exe` +
  installeur MSI). **Pas depuis WSL** — WSL produit un binaire Linux qui
  s'affichera à travers WSLg avec des décors GTK, pas la vraie chrome
  Windows.
- **Linux** : hors périmètre de distribution ; utilisable pour du dev.

```bash
pnpm install        # deps frontend
pnpm tauri dev      # lance l'app desktop (Vite + compile Rust + ouvre la fenêtre)
pnpm tauri build    # build un binaire distribuable
pnpm build          # type-check (tsc) + build frontend seul
cargo check         # (dans src-tauri/) vérifie le backend Rust
```

> Si `cargo` est introuvable dans une nouvelle session : `source "$HOME/.cargo/env"`.

## GraphQL — analyse (à l'étude, non tranché)

« Utiliser GraphQL » recouvre trois choses très différentes ; il faut les séparer.

**1. GraphQL comme transport interne frontend ↔ backend → à proscrire.**
En local, les **commandes Tauri (IPC)** sont déjà le canal natif, typé et à faible
latence. Ajouter GraphQL imposerait un serveur + un schéma + des resolvers à
l'intérieur de l'app pour **zéro bénéfice** (pas de réseau, pas de multi-client).
Mauvais compromis ici.

**2. GraphQL comme fonctionnalité : exposer/générer une API GraphQL depuis le
schéma de la base (façon PostGraphile / Hasura / Supabase) → pertinent, mais à
phaser tard et en module.**
- C'est une vraie valeur pour l'audience dev/DBA et cohérent avec l'ambition
  « outil complet ».
- Mais c'est un **sous-produit conséquent**, l'écosystème est très **Postgres-centré**
  (PostGraphile/Hasura), et ça **risque de diluer le différenciateur** (le travail
  DDL sur canvas) si on s'y attaque trop tôt.
- Synergie naturelle avec l'**explorateur de schéma (v0.3)** : les deux reposent
  sur une introspection profonde du schéma. À implémenter *après* lui, comme
  module optionnel.

**3. GraphQL comme source de données à interroger dans Graft (traiter un endpoint
GraphQL comme une connexion) → niche.**
Faible priorité pour un outil SQL/DBA ; envisageable bien plus tard.

**Recommandation :** ne pas mettre GraphQL dans le cœur ni l'amorcer tôt. Cible
réaliste = option **2**, en module post-v0.3 adossé à l'explorateur de schéma.
Clarifier l'intention exacte avant de planifier quoi que ce soit.

## Écarts assumés en v0.1

- Éditeur = **CodeMirror 6** (coloration + numéros de ligne + active line +
  bracket matching + autocomplétion schéma à la frappe + Ctrl/Cmd+Entrée)
  — l'essentiel de la v0.2 est donc déjà là.
- **Ergonomie éditeur classique** : sidebar avec schéma live (recherche, arbre
  tables/colonnes, double-clic pour insérer au curseur), actions par bloc
  (renommer, dupliquer, supprimer), table de résultats numérotée avec copie
  cellule au double-clic.
- Autocomplétion alimentée par l'introspection **SQLite** uniquement (Postgres/MySQL
  en v0.3).
- Seul **SQLite** est branché (Postgres/MySQL en v0.3) — mais `sqlx` est déjà
  choisi pour une API unifiée.
- Les arêtes entre blocs sont dessinables mais n'ont pas encore de sémantique
  d'exécution (ordre/dépendances) — à définir avec la granularité des blocs.
