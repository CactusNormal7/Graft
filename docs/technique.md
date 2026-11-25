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
| Tests | **Vitest** (frontend) + `cargo test` (backend) | Vitest réutilise la config Vite, aucun outillage à part |

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

> État des éléments du wireframe : la **palette ⌘K** (`CommandPalette.tsx`),
> la **vue graphique** des résultats (`ChartView.tsx`, Recharts), les **groupes**
> conteneurs (`GroupNode.tsx`) et l'**explorateur de schéma** SQLite (sidebar)
> sont fonctionnels. La minimap est celle de React Flow (sans enrichissement).
> Restent à faire : connexions Postgres/MySQL (v0.3) et minimap riche.

## Arborescence

```
Graft/
├── index.html                # point d'entrée Vite
├── package.json              # scripts + deps frontend
├── vite.config.ts            # config Vite (port fixe 1420 pour Tauri)
├── tsconfig.json
├── docs/                     # documentation vivante (ce dossier)
├── scripts/
│   └── install-sql-language-server.mjs # `pnpm lsp:install` : installe le LSP pour l'utilisateur
├── src/                      # frontend React
│   ├── main.tsx              # bootstrap : fonts + tokens + CSS React Flow + thème
│   ├── App.tsx               # routeur de vue (home / canvas) + coquille
│   ├── types.ts              # types domaine (BlockType, QueryResult, NotebookFile…)
│   ├── sqlFormat.ts          # quoteIdent / sqlLiteral / sqlEquals (échappement SQL centralisé — pas un formateur)
│   ├── formatSql.ts          # formatage SQL (sql-formatter, dialecte du moteur, {{favoris}} préservés)
│   ├── commands.ts           # commandes de l'app (useAppCommands) partagées palette / menus + SHORTCUTS
│   ├── shortcuts.ts          # libellés de raccourcis par plateforme (⌘⇧F / Ctrl+Shift+F)
│   ├── paths.ts              # basename() cross-platform (sépare sur / et \)
│   ├── native.ts             # dialogues natifs + confirmation + état « non sauvegardé » (commandes backend)
│   ├── test/schema.ts        # fixtures de schéma partagées par les tests Vitest
│   ├── dialogs/
│   │   ├── appDialogs.ts     # file de dialogues de l'app (showMessage/showError/askConfirm/askText → promesses)
│   │   └── AppDialogHost.tsx # rendu du dialogue en tête de file (modale aux tokens du DS)
│   ├── lsp/
│   │   ├── languageServer.ts # client LSP partagé (@codemirror/lsp-client) sur l'IPC Tauri
│   │   └── serverDiagnostics.ts # diagnostics publiés par le serveur, par document → offsets éditeur
│   ├── store/
│   │   ├── useGraftStore.ts  # store Zustand (view, pages, nodes/edges de la page active, dbPath, palette, actions)
│   │   └── snippets.ts       # favoris : expansion {{nom}} + normalisation des noms
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
│   │   ├── NewProjectModal.tsx # modale de création de projet (nom, emplacement, moteur, fichier SQLite)
│   │   ├── CommandPalette.tsx  # barre d'actions ⌘K / Ctrl+K (commandes + favoris) — état `paletteOpen` dans le store
│   │   ├── Toolbar.tsx       # barre du haut : connexion, +Block, Run all, zoom
│   │   ├── Sidebar.tsx       # explorateur de schéma live (tables/colonnes, recherche, insertion) + liste des blocs
│   │   ├── SqlEditor.tsx     # CodeMirror 6 SQLite : coloration, autocomplete schéma, gutter, brackets, Mod-Enter, diagnostics
│   │   ├── sqlDiagnostics.ts # localisation d'une erreur d'exécution dans le SQL (position moteur ou jeton cité)
│   │   ├── PageTabs.tsx      # barre d'onglets de pages (Excel-like) en bas du canvas
│   │   └── StatusBar.tsx     # barre de statut bas
│   └── canvas/
│       ├── GraftCanvas.tsx   # <ReactFlow> + dot-grid + Controls/MiniMap + empty state + drag→groupe
│       ├── SqlBlockNode.tsx  # nœud custom : header (titre éditable, dupliquer, supprimer, Run), éditeur, résultats
│       ├── ResultBlockNode.tsx # bloc résultat lié (lecture seule) d'un bloc SQL
│       ├── blockChrome.tsx   # UI partagée bloc SQL / bloc résultat : statut, icônes de vue, pied de résultat
│       ├── BlockContextMenu.tsx # menu contextuel générique (portail vers <body>)
│       ├── GroupNode.tsx     # nœud conteneur coloré (parent React Flow) : titre, couleur, resize
│       ├── editorRegistry.ts # registre id→EditorView pour insérer depuis la sidebar / la palette
│       ├── useInnerScroll.ts # scroll molette interne au bloc sélectionné (pinch = zoom canvas)
│       ├── ResultTable.tsx   # conteneur d'un result set : vue table, pagination client, menus cellule/ligne
│       ├── JsonTreeView.tsx  # vue json : arbre repliable
│       ├── ChartView.tsx     # vue chart : Recharts (bar/line/area/pie) + config
│       ├── resultShape.ts    # détection parent→enfants d'un JOIN, rowToObject (colonnes dupliquées suffixées _2…)
│       ├── orm.ts            # pont relationnel : résultat/JSON imbriqué → INSERT multi-tables
│       ├── rowSql.ts         # SQL des actions par ligne (UPDATE / DELETE / dupliquer / ouvrir) sur table résolue
│       └── clipboard.ts      # copie presse-papiers
└── src-tauri/                # backend Rust (Tauri)
    ├── Cargo.toml            # deps Rust (tauri, sqlx, tokio, plugins)
    ├── tauri.conf.json       # config app (fenêtre, bundle, identifier)
    ├── capabilities/default.json  # permissions du webview : `core:default` uniquement
    └── src/
        ├── main.rs           # appelle graft_lib::run()
        ├── lib.rs            # Builder Tauri, commandes, garde fermeture/quit si non sauvegardé
        ├── db.rs             # moteur SQLite (execute_sql, introspect_schema) + tests
        ├── notebook.rs       # E/S fichiers (atomique, .graft only / chemins accordés), projets + tests
        ├── scope.rs          # FileScope : chemins accordés par dialogue pour la session + tests
        ├── dialogs.rs        # dialogues natifs côté backend (fichiers, dossier, confirmation)
        └── lsp.rs            # processus sql-language-server : résolution, framing LSP, pont IPC + tests
```

## Flux de données

### Exécution d'une requête
1. L'utilisateur clique **▶ Run** sur un bloc → `runBlock(id)` dans le store.
2. Le store passe le bloc en `running` et appelle la commande Tauri
   `invoke("execute_sql", { dbPath, sql, maxRows: MAX_FETCH_ROWS })`.
3. Côté Rust (`db.rs`) : ouverture d'**une** connexion `SqliteConnection` sur
   `dbPath` (`SqliteConnectOptions::filename` + `create_if_missing` — pas de
   parsing d'URL, donc les chemins Windows ou contenant `?`/`#` passent tels
   quels ; pas de pool pour une unité de travail unique), puis :
   - statement qui renvoie des lignes — détecté après avoir sauté les
     **commentaires de tête** (`-- …`, `/* … */`) : `select`/`with`/`pragma`/
     `explain`/`values`, ou tout statement contenant le mot-clé `RETURNING` →
     lecture en **flux** (`fetch`) : seules les `max_rows` premières lignes sont
     converties en `serde_json::Value` (sondage de types i64 → f64 → bool →
     String → blob), les suivantes sont seulement **comptées** (jamais
     matérialisées en mémoire). Un résultat vide garde ses **noms de colonnes**
     (lus via `prepare` du statement) pour afficher les en-têtes ;
   - sinon (`INSERT`/`UPDATE`/DDL…) → `execute`, on renvoie `rows_affected`.
4. Le résultat (`QueryResult { columns, rows, rows_affected, elapsed_ms,
   total_rows, truncated }`) revient au store, qui met le bloc en `success` (ou
   `error`) et déclenche le rendu inline (`ResultTable` ou message d'erreur).

**Plafond de lignes (perf)** — la conversion JSON + la sérialisation IPC de
Tauri sont le vrai coût d'un gros résultat (50 000 lignes × 19 colonnes ≈ 950 000
valeurs). `execute_sql` ne convertit donc que les `max_rows` premières lignes
(défaut **5000**, `MAX_FETCH_ROWS` côté store), tout en renvoyant le **vrai**
total (`total_rows`) et un drapeau `truncated` affiché dans le pied du bloc
(« 5000 / 50000 row(s) · truncated »). L'UI pagine ensuite ces lignes (100/page).

### Projets (création / ouverture / sauvegarde)
Un **projet** = un fichier `.graft` + une connexion (type + base). Cycle de vie :

- **Créer** (`createProject(name, dir, dbType)`) : `create_project_paths` valide
  le nom (non vide, ni `.`/`..`, ni séparateur de chemin ni caractère interdit
  sous Windows), **refuse un `.graft` déjà existant** (sinon la première
  sauvegarde l'écraserait), puis dérive `<dir>/<name>.graft` et `<dir>/<name>.db`
  (join natif cross-platform) ; le store
  passe en `canvas` avec un canevas vide, puis **écrit immédiatement le `.graft`**
  (`save_notebook`) → le projet est persisté dès sa création. La modale propose un
  emplacement par défaut (`default_project_dir` = `<Documents|Home>/Graft`) et un
  *Browse* (dialogue dossier).
- **Sauvegarder** (`saveNotebook()`) : écrit dans le `projectPath` courant **sans
  dialogue** (le projet a toujours un chemin). L'état d'exécution transitoire
  (status/result/error) est remis à zéro avant écriture → fichiers diff-friendly.
  L'écriture est **atomique** (fichier temporaire `<fichier>.tmp` puis `rename`) :
  un crash ou un disque plein en cours d'écriture laisse l'ancienne version
  intacte. Une erreur d'écriture est signalée à l'utilisateur.
- **Ouvrir** : `openProjectByPath(path)` (clic sur un récent) ou
  `openProjectFromDialog()` (Open file…) lit le JSON via `load_notebook` et
  reconstruit `name`/`dbType`/`dbPath`/nodes/edges. Si le fichier est illisible,
  l'entrée est purgée des récents.
- **Revenir** : `goHome()` garde le projet chargé ; l'accueil affiche alors
  « ↩ Back to <projet> » (`resumeProject()`).

### Modifications non sauvegardées
Le projet est **« dirty »** quand ce qui serait écrit sur disque diffère de ce
qui a été sauvegardé ou ouvert en dernier. Plutôt que de marquer chaque action,
le store compare une **empreinte** (`fingerprint` = `serializeNotebook` en JSON,
sans `dbSchema`) à celle enregistrée par `markSaved` (création, ouverture,
sauvegarde). Conséquence : ce que le fichier ne stocke pas — résultats, statut
d'exécution, sélection, viewport — ne rend jamais le projet dirty ; éditer du
SQL, déplacer/redimensionner un bloc, renommer, changer de vue de résultat,
oui.

- `hasUnsavedChanges(state)` : calcul **exact et synchrone**, utilisé par les
  gardes. `createProject` et `openProjectByPath` demandent confirmation
  (`confirmDialog` natif, « Discard changes ») avant d'abandonner des
  changements ; refus → rien ne change (`createProject` renvoie `false` et la
  modale reste ouverte).
- `state.dirty` : même information, **débouncée** (250 ms, `subscribe` sur
  `nodes`/`edges`/`pages`/`snippets`) pour l'UI — point orange après le nom du
  projet dans la toolbar, « Save ● », « ↩ Back to <projet> ● » sur l'accueil.
- Chaque bascule de `dirty` est poussée au backend (`set_unsaved_changes`) :
  `lib.rs` intercepte **la fermeture de la fenêtre** (`WindowEvent::CloseRequested`)
  et **la sortie de l'app** (`RunEvent::ExitRequested` sans code, ex. ⌘Q sur
  macOS) et affiche une confirmation native « Quit without saving » ; le drapeau
  est remis à zéro avant de fermer pour ne pas redemander.
- **⌘S / Ctrl+S** sauvegarde (écouteur global dans `App.tsx`, actif sur le
  canvas, y compris depuis un éditeur).

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
  `src/canvas/editorRegistry.ts` (map `id → EditorView`) via le callback
  `onCreateEditor` de `@uiw/react-codemirror` — la vue est créée de façon
  asynchrone (après un re-render), elle n'est donc pas encore disponible dans un
  `useEffect` de montage — et remonte son focus
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
- **Erreurs en ligne (diagnostics)** : `execute_sql` renvoie en cas d'échec
  une erreur structurée `SqlError { message, position }` (`position` = offset
  dans le SQL exécuté, en unités UTF-16 — un index de chaîne JavaScript).
  **SQLite** : sqlx n'expose pas `sqlite3_error_offset` et efface l'état
  d'erreur avant qu'on puisse le lire ; `db.rs` **re-prépare** donc (sans
  rien exécuter) les instructions une à une via `libsqlite3-sys` (même version
  que celle de sqlx) jusqu'à celle qui échoue avec le **même message**, et lit
  l'offset à ce moment-là (relatif à l'instruction → rendu absolu). Si
  l'erreur dépend d'une instruction précédente exécutée (table créée plus
  haut), la re-préparation échoue autrement et aucune position n'est
  annoncée. `runBlock` appelle ensuite `locateError`
  (`components/sqlDiagnostics.ts`, pur et testé) qui choisit la plage à
  souligner : la position moteur si le SQL a été exécuté tel quel (pas de
  `{{favori}}` expansé, sinon les offsets pointeraient dans l'expansion), sinon
  le jeton cité par le message (`near "FORM"` pour SQLite/Postgres,
  `near '…' at line N` pour MySQL, recherché à partir de la ligne indiquée),
  sinon la première ligne non vide. Le résultat est stocké sur le bloc source
  (`data.editorError = { from, to, message }`, transitoire : remis à zéro à la
  sauvegarde, au run suivant et à la première édition) et appliqué par
  `SqlEditor` via `setDiagnostics` (`@codemirror/lint`, extension `linter(null)`
  déclarée d'office : sinon celle que `setDiagnostics` ajoute à la volée
  disparaît — avec le soulignement — à chaque reconfiguration de l'éditeur,
  ex. rafraîchissement du schéma ou arrivée du LSP) : soulignement ondulé
  `--error` + infobulle au survol. Le message reste aussi affiché sous
  l'éditeur.
- Le nœud (`SqlBlockNode`) expose aussi **titre éditable** (double-clic),
  **dupliquer** (⧉), **supprimer** (✕) et **▶ Run** — le run est aussi
  déclenché par `Mod-Enter`.

### Dialogues de l'app
Les `alert` / `confirm` / `prompt` du webview sont **proscrits** (aspect
navigateur sur macOS/Windows, bloquants). `src/dialogs/appDialogs.ts` expose
`showMessage` / `showError` / `askConfirm` / `askText`, qui renvoient une
**promesse** et ajoutent une requête à une petite file Zustand
(`useDialogStore`) : deux erreurs successives sont donc affichées l'une après
l'autre. `AppDialogHost` (monté à la racine de `App`, accueil et canvas) rend la
première requête avec les classes `.modal` / `.btn-accent` / `.btn-danger`
bâties sur les tokens (`--error`, `--panel`, `--shadow-modal`…) ; Entrée valide
un champ texte, Échap annule, les touches ne fuient pas vers le canvas.
Utilisés par : erreurs d'ouverture/sauvegarde/création de projet, import/export,
génération d'INSERT, formatage, nom d'un favori (`askText`), suppression d'un
favori (`askConfirm`, bouton danger). La confirmation « modifications non
sauvegardées » reste un **dialogue natif** (`confirm_dialog`, comme la garde de
fermeture côté Rust).

### Formatage SQL
- `src/formatSql.ts` : `formatSql(sql, dbType)` s'appuie sur **`sql-formatter`**
  (dialecte `sqlite` / `postgresql` / `mysql` selon le moteur du projet,
  mots-clés en majuscules, indentation 2). Dépendance ajoutée car
  `sql-language-server` n'expose **pas** de formatage (pas de
  `documentFormattingProvider`) et `src/sqlFormat.ts` ne fait que de
  l'échappement. Les références `{{favori}}` sont déclarées comme paramètres
  personnalisés : elles restent intactes.
- `store.formatBlock(id)` / `formatFocusedBlock()` : remplace le SQL **via
  l'éditeur** quand il est monté (`replaceEditorContent` du registre → la
  modification est annulable par Ctrl/Cmd+Z), sinon directement dans le
  store. SQL non analysable → texte inchangé, erreur signalée.
- Points d'entrée : raccourci **Shift+Alt+F** (⇧⌥F sur macOS) dans l'éditeur,
  entrée **Format SQL** du menu contextuel du bloc, commande **Format SQL** de
  la palette.

### Palette de commandes (⌘K)
`CommandPalette.tsx` liste les **commandes de l'app** (`useAppCommands` dans
`src/commands.ts` : formater, exécuter le bloc focalisé / tout, nouveau bloc
par type, groupe, page, sauvegarder, importer, rafraîchir le schéma, zoom,
accueil) puis les **favoris**. Une commande désactivée (ex. « Format SQL »
sans bloc focalisé) n'est pas proposée. La même liste alimente la barre de
menus native. Les raccourcis sont écrits une fois (`SHORTCUTS`, forme
`Mod+Shift+F`) et affichés selon la plateforme (`shortcutLabel`).

### Serveur de langage SQL (LSP) — `sql-language-server`

**Choix de livraison : processus externe optionnel, résolu à l'exécution**
(pas de sidecar Tauri embarqué pour l'instant).

- `sql-language-server` (joe-re, choix acté dans `CLAUDE.md`) est un programme
  **Node** : l'embarquer en sidecar suppose d'embarquer un runtime Node (ou de
  le compiler en binaire autonome), et il dépend du module natif `sqlite3`,
  compilé par plateforme. Le paquet publié (1.7.1) casse en plus avec la
  version de `vscode-languageserver-protocol` résolue par défaut
  (`ERR_PACKAGE_PATH_NOT_EXPORTED`) : il faut épingler la 3.16.0. Trop fragile
  pour un bundle macOS/Windows à ce stade.
- **Installation** : `pnpm lsp:install` (`scripts/install-sql-language-server.mjs`)
  l'installe dans le dossier de données utilisateur
  (`~/Library/Application Support/Graft/sql-language-server` sur macOS,
  `%APPDATA%\Graft\sql-language-server` sur Windows) avec la version de
  protocole épinglée et `--ignore-scripts` (le driver natif `sqlite3` n'est
  pas utilisé, cf. plus bas).
- **Résolution** (`src-tauri/src/lsp.rs`, `resolve_command`) : variable
  `GRAFT_SQL_LANGUAGE_SERVER` → exécutable à côté du binaire Graft (emplacement
  d'un futur sidecar) → installation utilisateur ci-dessus → `PATH`. Absent →
  `lsp_start` renvoie `false` et l'éditeur garde son autocomplétion native :
  **dégradation silencieuse**, rien n'est cassé.
- **Pont** : le webview ne peut pas lancer de processus. `lsp_start` lance
  `sql-language-server up --method stdio` (une seule instance, réutilisée) ;
  un thread lit stdout, découpe les messages (en-têtes `Content-Length`,
  `read_message`) et les émet en événements Tauri `lsp-message` ; `lsp_send`
  encadre (`encode_message`) et écrit sur stdin. Le protocole lui-même est géré
  côté front par **`@codemirror/lsp-client`** (`src/lsp/languageServer.ts`,
  transport sur l'IPC Tauri). Seul `LSPPlugin.create` (synchro du document)
  est branché dans l'éditeur, pas `languageServerSupport` : ses keymaps
  détourneraient Shift+Alt+F vers un formatage LSP que ce serveur n'offre pas.
  Le client déclare la capacité `workspace.configuration`, sans laquelle le
  serveur **ignore** `didChangeConfiguration` (donc la config lint). Un seul client pour tous les blocs ; chaque bloc
  est un document `file:///graft/<id>.sql`.
- **Apport** : complétions du serveur (`serverCompletionSource`) ajoutées aux
  sources existantes (schéma + mots-clés), et diagnostics `sqlint`. Les règles
  de mise en page de sqlint (alignements, retours à la ligne, casse des
  mots-clés) sont **désactivées** — elles se battent avec un éditeur libre sur
  canvas ; restent `space-surrounding-operators` et
  `require-as-to-rename-column` en avertissement.
- **Diagnostics du serveur = niveau « info »** (`src/lsp/serverDiagnostics.ts`,
  fusionnés avec l'erreur d'exécution dans `SqlEditor`) : son parseur ne couvre
  qu'un sous-ensemble de SQL et signale à tort `PRAGMA`, `CREATE TRIGGER` ou les
  procédures — exactement le travail d'un DBA. Le moteur reste seul juge des
  erreurs (niveau « error »).
- **Confidentialité** : le serveur journalise **tout** ce qu'il reçoit (niveau
  debug forcé) dans `<tmp>/sql-language-server.log`, SQL des blocs compris.
  Graft ne lui transmet donc **aucune connexion ni identifiant** — le schéma
  vient de l'introspection native de Graft.

## Commandes Tauri exposées (`lib.rs`)

| Commande | Signature | Rôle |
|----------|-----------|------|
| `execute_sql` | `(db_path: String, sql: String, max_rows: Option<usize>) -> Result<QueryResult, SqlError>` | exécute un statement SQLite ; **plafonne** les lignes renvoyées (défaut 5000) ; erreur = `{ message, position }` |
| `introspect_schema` | `(db_path: String) -> Result<Vec<TableInfo>, String>` | structure SQLite : tables/vues, colonnes (type, notnull, pk) et **clés étrangères** |
| `save_notebook` | `(path: String, contents: String) -> Result<(), String>` | écrit un `.graft` (atomique) |
| `load_notebook` | `(path: String) -> Result<String, String>` | lit un `.graft` |
| `write_text_file` | `(path: String, contents: String) -> Result<(), String>` | écrit un fichier texte (export `.sql`, atomique) — **chemin accordé en écriture** requis |
| `read_text_file` | `(path: String) -> Result<String, String>` | lit un fichier texte (import `.json`/`.sql`) — **chemin accordé en lecture** requis |
| `pick_project_file` | `() -> Result<Option<String>, String>` | dialogue « ouvrir un `.graft` » |
| `pick_sqlite_file` | `() -> Result<Option<String>, String>` | dialogue « choisir une base SQLite » |
| `pick_directory` | `() -> Result<Option<String>, String>` | dialogue « choisir un dossier » (emplacement projet) |
| `pick_import_file` | `() -> Result<Option<String>, String>` | dialogue import `.json`/`.sql` ; **accorde la lecture** du chemin choisi |
| `pick_export_file` | `(default_name: String) -> Result<Option<String>, String>` | dialogue export `.sql` ; **accorde l'écriture** du chemin choisi |
| `confirm_dialog` | `(title, message, ok_label) -> Result<bool, String>` | confirmation native OK/Annuler |
| `set_unsaved_changes` | `(dirty: bool)` | reflète l'état « non sauvegardé » pour la garde fermeture/quit |
| `lsp_start` | `() -> Result<bool, String>` | lance `sql-language-server` s'il est installé (idempotent) ; `false` sinon |
| `lsp_send` | `(message: String) -> Result<(), String>` | envoie un message JSON-RPC au serveur (réponses : événement `lsp-message`) |
| `default_project_dir` | `() -> Result<String, String>` | dossier projet par défaut `<Documents\|Home>/Graft` (créé) |
| `create_project_paths` | `(dir, name) -> Result<{projectPath, dbPath}, String>` | valide le nom, refuse un projet existant, dérive `.graft`/`.db` (join cross-platform) |

> Convention : `db_path`/`sql` côté Rust (snake_case) ↔ `dbPath`/`sql` côté JS
> (Tauri convertit automatiquement le camelCase en snake_case).

## Sécurité du webview

Le webview est traité comme **non fiable** : du contenu rendu (une valeur de
cellule, un fichier importé) ne doit pas pouvoir, via une injection de script,
lire ou écrire n'importe quel fichier du disque.

- **CSP stricte** (`tauri.conf.json` → `app.security.csp`) : `default-src 'self'`,
  `script-src 'self'` (aucun script inline ni distant), `connect-src ipc:
  http://ipc.localhost` (uniquement l'IPC Tauri), `object-src`/`base-uri`/
  `form-action 'none'`, polices et images `'self' data:` (les polices
  `@fontsource` sont inlinées en `data:` par Vite). `style-src` garde
  `'unsafe-inline'` : CodeMirror injecte ses feuilles de style et React/Recharts
  posent des attributs `style` ; c'est pourquoi
  `dangerousDisableAssetCspModification: ["style-src"]` empêche Tauri d'y
  ajouter des nonces (un nonce désactiverait `'unsafe-inline'`). `devCsp` ajoute
  seulement ce que Vite exige en dev (script inline du préambule React Refresh,
  websocket HMR sur `localhost:1420`).
- **Permissions minimales** (`capabilities/default.json`) : `core:default`
  seulement. Le plugin dialog reste initialisé côté Rust mais le webview n'y a
  **pas** accès directement ; le plugin opener (inutilisé) a été retiré.
- **Dialogues côté backend** (`dialogs.rs`, wrappers `src/native.ts`) : le
  backend fixe les filtres et, pour import/export, **accorde** le chemin choisi
  dans un `FileScope` de session (`scope.rs`, accès `Read` ou `Write` par
  chemin exact).
- **Commandes fichiers restreintes** (`notebook.rs`) : `read_text_file` /
  `write_text_file` refusent tout chemin non accordé (une autorisation
  d'écriture n'est pas une autorisation de lecture) ; `save_notebook` /
  `load_notebook` ne touchent que des fichiers **`.graft`** (les projets récents
  vivant dans `localStorage`, on ne peut pas exiger un dialogue à chaque
  réouverture). `path_exists` (inutilisée) a été supprimée.
- **Limite assumée** : `execute_sql` exécute le SQL de l'utilisateur tel quel —
  c'est la fonction même de l'outil — donc `ATTACH DATABASE` peut toujours créer
  un fichier SQLite où l'on veut. La protection porte sur les commandes
  fichiers, pas sur le moteur SQL.

## Format de fichier `.graft`

Depuis la **version 4**, le fichier est **paginé** : `pages[]` (onglets type
Excel), chacune avec ses propres `nodes`/`edges`. Les fichiers v1–v3 (canvas plat
avec `nodes`/`edges` à la racine) restent lisibles et sont migrés en une page
unique « Page 1 » (`pagesFromFile`). Les nœuds ont la même forme qu'avant.

```jsonc
{
  "version": 5,                            // 1 pré-blocs liés · 2 blocs liés · 3 groupes+parentId · 4 pages · 5 schéma en cache + favoris (rétro-compatible en lecture)
  "name": "analytics",
  "dbType": "sqlite",                      // sqlite | postgres | mysql
  "dbPath": "/chemin/vers/base.sqlite",   // ou null
  "dbSchema": [ /* TableInfo[] — cf. « Schéma en cache » */ ],
  "snippets": [ { "id": "block-...", "name": "recent_users", "sql": "SELECT …", "blockType": "query" } ],
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
écrit par l'utilisateur. Le nom d'un favori est normalisé à l'enregistrement
(`toSnippetName` : tout caractère hors `[A-Za-z0-9_.-]` devient `_`) pour
rester référençable — « Query 1 » aurait sinon été un favori impossible à
appeler.

**Pont relationnel (ORM) — `src/canvas/orm.ts`** — la vue JSON/imbriquée est
traitée comme une **vraie source de données relationnelle**. Tout y est pur
(pas de React/store/Tauri), donc testable isolément :

- `matchTable(columns, schema)` — retrouve la table cible par recouvrement de
  noms de colonnes (seuil 60 %), en **excluant les vues** (pas d'INSERT dessus) ;
  à score égal, la table la plus étroite gagne.
- `findForeignKey(child, parent)` — la FK reliant les deux tables, lue depuis le
  schéma en cache (`dbSchema`).
- `generateInserts(result, schema)` — si le résultat a une forme parent→enfants
  (`detectNestedShape`) **et** que les deux côtés correspondent à des tables
  réelles, sort des INSERT **relationnels** : un INSERT parent puis ses enfants,
  avec la FK renseignée : valeur explicite de la colonne visée par la FK (ou de
  la PK) si elle est sélectionnée, sinon la sous-requête
  `(SELECT <clé> FROM <parent> ORDER BY rowid DESC LIMIT 1)`. On n'utilise
  **pas** `last_insert_rowid()` : dès le premier INSERT enfant il désigne
  l'enfant, et le 2ᵉ enfant aurait été rattaché au 1ᵉʳ. Une ligne sans colonne
  mappable devient `INSERT … DEFAULT VALUES`. Sinon, repli sur des INSERT plats
  ligne à ligne,
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
`read_text_file`. L'échappement SQL (`quoteIdent`/`sqlLiteral`) est centralisé
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
- **`json`** — un **arbre JSON interactif** (`JsonTreeView.tsx`) : chaque
  objet/tableau est repliable (comme un éditeur
  JSON), avec **▼ all / ▶ all** et un défaut d'ouverture par profondeur.
  Les données affichées sont **soit** le document relationnel ré-imbriqué quand
  `detectNestedShape` trouve une relation `JOIN` (objet parent + tableau
  d'enfants via `buildNestedGroups`/`groupToObject`), **soit** le tableau plat
  des objets ligne. Colorisé par type.
- **`chart`** — trace le résultat via **Recharts** (`ChartView.tsx`) : type
  `bar`/`line`/`area`/`pie`, une colonne X, une ou
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
All) apparaît au-delà de 100 éléments, ou dès que la taille de page choisie
découpe le résultat (sinon un 50/page choisi sur un gros résultat masquait des
lignes d'un résultat suivant plus petit). `chart` trace tout le résultat (pas
de page). Les noms de colonnes dupliqués (`SELECT a.id, b.id`) sont suffixés
(`id`, `id_2`) dans les vues json/chart et les copies JSON au lieu de
s'écraser ; dans le menu cellule, une valeur `NULL` produit `IS NULL` (et non
`= NULL`, qui ne matche jamais).

**Actions par ligne (`rowSql.ts`)** — les entrées « Set NULL / Open row /
Duplicate row / Delete row » du menu contextuel **génèrent du SQL dans un
nouveau bloc `script`** (`store.openSqlBlock`) au lieu de modifier la base
directement : pour une audience DBA, une écriture se relit avant d'être
exécutée. `resolveRowTarget(columns, dbSchema)` n'accepte une cible que si
elle est sûre : pas de nom de colonne dupliqué, **toutes** les colonnes du
résultat appartiennent à une seule table (vues exclues ; à égalité, la table
ayant exactement ces colonnes, sinon refus « ambiguë »), table avec clé
primaire déclarée, et **toute** la clé (composite comprise) présente dans le
résultat. Sinon l'action est grisée et `hint` (infobulle) en donne la raison —
`BlockContextMenu` utilise `aria-disabled` plutôt que `disabled` pour que
l'infobulle reste visible. La clé d'une ligne est comparée avec `sqlEquals`
(`IS NULL` pour une clé nulle). La duplication omet une clé
`INTEGER PRIMARY KEY` (alias de rowid, assignée par SQLite) et recopie toute
autre clé avec un commentaire demandant de la modifier.

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
pnpm test           # tests frontend (Vitest, une passe)
pnpm test:watch     # Vitest en mode watch
cargo test          # (dans src-tauri/) tests unitaires db.rs / notebook.rs / scope.rs / lsp.rs
pnpm lsp:install    # installe sql-language-server (optionnel) pour l'utilisateur courant
```

**Tests frontend (Vitest)** — fichiers `*.test.ts` à côté du code testé,
environnement `node`, config reprise de `vite.config.ts`. Couvrent les modules
purs (`orm.ts`, `rowSql.ts`, `resultShape.ts`, `snippets.ts`, `sqlFormat.ts`,
`paths.ts`) et le store (`useGraftStore.test.ts` : suivi des modifications non
sauvegardées et confirmation, avec `@tauri-apps/api/core` et `src/native.ts`
remplacés par des faux via `vi.mock`). Fixtures de schéma : `src/test/schema.ts`.

> Sous Linux/WSL, `cargo check`/`cargo test` exigent les libs de dev GTK/WebKit
> de Tauri (`libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libsoup-3.0-dev`…).

> Le test `lsp::tests::initializes_a_real_server_when_installed` ne s'exécute
> vraiment que si `GRAFT_SQL_LANGUAGE_SERVER` pointe sur un serveur (sinon il
> passe sans rien faire) :
> `GRAFT_SQL_LANGUAGE_SERVER=<data>/Graft/sql-language-server/node_modules/.bin/sql-language-server cargo test lsp`.

> Si `cargo` est introuvable dans une nouvelle session : `source "$HOME/.cargo/env"`.

## Intégration Claude — MCP / connecteur personnalisé (à faire)

**Besoin acté :** Graft devra s'intégrer à **Claude** pour que l'assistant puisse
travailler *dans* un projet Graft — lire le schéma, lire/écrire des blocs,
exécuter des requêtes, proposer des migrations — depuis Claude Desktop, Claude
Code ou claude.ai. Le véhicule standard est le **Model Context Protocol (MCP)**.
Rien n'est implémenté à ce stade ; cette section fixe la direction.

**Deux formes, à phaser :**

1. **Serveur MCP local (stdio) — première étape.** Un binaire `graft-mcp`
   lancé par le client Claude (Claude Desktop / Claude Code le déclarent dans
   leur config MCP). Il fonctionne **sans que l'app soit ouverte**, directement
   sur les fichiers `.graft` et la base. Implémentation recommandée en **Rust**
   (SDK MCP officiel `rmcp`) pour **réutiliser le moteur existant** : extraire
   `db.rs` / `notebook.rs` (et à terme la sérialisation du `.graft`, aujourd'hui
   côté TypeScript) dans un crate `graft-core` partagé par l'app Tauri et le
   serveur MCP, dans un workspace Cargo. Distribution : sidecar Tauri livré avec
   l'app (macOS + Windows), plus une commande « Installer dans Claude Desktop »
   qui écrit l'entrée de config.
2. **Connecteur personnalisé (MCP distant) — étape ultérieure.** Pour claude.ai
   (web/mobile), un connecteur personnalisé pointe vers un serveur MCP joignable
   en **HTTPS** (transport *Streamable HTTP*) avec **OAuth**. Graft étant une
   app desktop locale, cela suppose un relais/tunnel ou une brique cloud
   (synchro de projets) — à n'envisager que si une telle brique existe.

**Surface MCP envisagée :**
- *Tools* : `list_projects`, `get_schema(project)`, `list_blocks(project, page?)`,
  `read_block`, `create_block` / `update_block` (SQL, titre, type, position),
  `run_query(project, sql)`, `run_block(project, block_id)`,
  `generate_inserts(project, block_id)`, `explain_query`.
- *Resources* : schéma introspecté (`graft://<projet>/schema`), SQL de chaque
  bloc, favoris `{{nom}}` (qu'il faut **expanser** comme le fait `runBlock`
  avant toute exécution).
- *Prompts* : « écrire une migration pour… », « expliquer ce plan
  d'exécution », « documenter ce schéma ».

**Synchronisation avec l'app ouverte.** Si le serveur MCP modifie un `.graft`
pendant que l'app l'affiche, les deux versions divergent (aujourd'hui la
sauvegarde de l'app écraserait les changements de Claude). Étapes :
(a) l'app **surveille** le fichier ouvert et propose de recharger / fusionne ;
(b) plus tard, un **pont local** (socket localhost authentifié par jeton, exposé
par l'app Tauri) auquel le serveur MCP parle quand l'app est ouverte, pour que
les blocs créés par Claude apparaissent **en direct** sur le canvas.

**Garde-fous (non négociables pour une audience DBA) :**
- `run_query` **en lecture seule par défaut** (connexion SQLite ouverte en
  `read_only`, transaction en lecture seule côté Postgres/MySQL) ; écritures
  (DML/DDL) uniquement via un tool distinct, opt-in par projet, avec
  confirmation côté client.
- Plafond de lignes réutilisé (`max_rows`) pour ne pas saturer le contexte.
- Accès fichiers limité aux projets connus — même principe que la protection
  du webview (§ Sécurité du webview : `.graft` uniquement, sinon chemins
  explicitement accordés) ; pas de lecture/écriture de chemins arbitraires.
- Jamais d'identifiants (mots de passe Postgres/MySQL) dans les réponses ; les
  secrets vivent dans le trousseau de l'OS.

**Phasage proposé :** extraction de `graft-core` → serveur MCP stdio
(SQLite, lecture seule + édition de blocs) → surveillance de fichier dans l'app
→ écritures opt-in → support Postgres/MySQL (v0.3) → pont live → connecteur
distant si une brique cloud voit le jour.

> Distinct de l'autre direction possible — **Claude dans Graft** (panneau
> assistant appelant l'API Claude depuis l'app) — qui peut venir en complément
> mais ne remplace pas l'intégration MCP.

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
  (renommer, dupliquer, replier, supprimer), table de résultats numérotée avec
  menus cellule/ligne.
- Fonctions **en avance sur la roadmap** : vues de résultat `json`/`chart`,
  **groupes** conteneurs (prévus en v1.0), **pages**, **favoris** `{{nom}}`,
  **palette ⌘K**, pont ORM (INSERT multi-tables).
- Autocomplétion alimentée par l'introspection **SQLite** uniquement (Postgres/MySQL
  en v0.3).
- Seul **SQLite** est branché (Postgres/MySQL en v0.3) — mais `sqlx` est déjà
  choisi pour une API unifiée.
- Les arêtes entre blocs sont dessinables mais **purement visuelles** : aucune
  sémantique d'exécution (ordre/dépendances) — liée à la question ouverte de la
  granularité des blocs.
- Pas encore de **barre de menus native**.
