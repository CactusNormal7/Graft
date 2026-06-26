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
| Éditeur SQL | `textarea` (v0.1) → **Monaco** (v0.2) | l'éditeur riche arrive en v0.2 |
| État | **Zustand** | évite les re-renders en cascade du Context API |
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

### Coquille applicative (app shell)

Graft cible une **application desktop classique**, pas un canvas plein écran :

- **Barre latérale (sidebar)** : connexions, explorateur de schéma, navigation
  entre notebooks/vues.
- **Barre de menus native** (Fichier, Édition, Affichage, Fenêtre…) via l'**API
  Menu de Tauri**, rendue nativement sur **macOS** (menu bar système) et
  **Windows** (menu de fenêtre).
- **Canvas** comme surface centrale parmi d'autres (console SQL, grille de
  données, diagrammes…), pas comme l'application entière.

> Le squelette v0.1 (canvas quasi nu) est **à revoir** pour intégrer cette
> coquille. Le design détaillé passera par Claude Design.

## Arborescence

```
Graft/
├── index.html                # point d'entrée Vite
├── package.json              # scripts + deps frontend
├── vite.config.ts            # config Vite (port fixe 1420 pour Tauri)
├── tsconfig.json
├── docs/                     # documentation vivante (ce dossier)
├── src/                      # frontend React
│   ├── main.tsx              # bootstrap React + import du CSS React Flow
│   ├── App.tsx               # <ReactFlowProvider> + <GraftCanvas>
│   ├── App.css               # thème sombre, styles blocs/toolbar/table
│   ├── types.ts              # types domaine (BlockType, QueryResult, NotebookFile…)
│   ├── store/
│   │   └── useGraftStore.ts  # store Zustand (nodes, edges, dbPath, actions)
│   └── canvas/
│       ├── GraftCanvas.tsx   # <ReactFlow> + Background/Controls/MiniMap
│       ├── SqlBlockNode.tsx  # nœud custom : header, éditeur, Run, résultats
│       ├── Toolbar.tsx       # barre : connexion DB, ajout de blocs, save/open
│       └── ResultTable.tsx   # rendu d'un result set en table
└── src-tauri/                # backend Rust (Tauri)
    ├── Cargo.toml            # deps Rust (tauri, sqlx, tokio, plugins)
    ├── tauri.conf.json       # config app (fenêtre, bundle, identifier)
    ├── capabilities/default.json  # permissions (core, opener, dialog)
    └── src/
        ├── main.rs           # appelle graft_lib::run()
        ├── lib.rs            # Builder Tauri + enregistrement des commandes
        ├── db.rs             # moteur d'exécution SQLite (execute_sql)
        └── notebook.rs       # save_notebook / load_notebook (fichiers .graft)
```

## Flux de données

### Exécution d'une requête
1. L'utilisateur clique **▶ Run** sur un bloc → `runBlock(id)` dans le store.
2. Le store passe le bloc en `running` et appelle la commande Tauri
   `invoke("execute_sql", { dbPath, sql })`.
3. Côté Rust (`db.rs`) : ouverture d'un `SqlitePool` sur `dbPath`
   (`create_if_missing`), exécution d'**un** statement :
   - statement qui renvoie des lignes (`select`/`with`/`pragma`/`explain`) →
     `fetch_all`, conversion de chaque cellule en `serde_json::Value` (sondage de
     types i64 → f64 → bool → String → blob) ;
   - sinon (`INSERT`/`UPDATE`/DDL…) → `execute`, on renvoie `rows_affected`.
4. Le résultat (`QueryResult { columns, rows, rows_affected, elapsed_ms }`)
   revient au store, qui met le bloc en `success` (ou `error`) et déclenche le
   rendu inline (`ResultTable` ou message d'erreur).

### Persistance (notebook `.graft`)
- **Save** : `saveNotebook()` ouvre un dialogue (plugin dialog), sérialise
  `{ version, dbPath, nodes, edges }` en JSON indenté, puis `invoke("save_notebook")`
  écrit le fichier. L'état d'exécution transitoire (status/result/error) est
  remis à zéro avant écriture → fichiers diff-friendly.
- **Open** : `loadNotebook()` lit le JSON via `invoke("load_notebook")` et
  reconstruit nodes/edges + `dbPath` dans le store.

## Commandes Tauri exposées (`lib.rs`)

| Commande | Signature | Rôle |
|----------|-----------|------|
| `execute_sql` | `(db_path: String, sql: String) -> Result<QueryResult, String>` | exécute un statement SQLite |
| `save_notebook` | `(path: String, contents: String) -> Result<(), String>` | écrit un `.graft` |
| `load_notebook` | `(path: String) -> Result<String, String>` | lit un `.graft` |

> Convention : `db_path`/`sql` côté Rust (snake_case) ↔ `dbPath`/`sql` côté JS
> (Tauri convertit automatiquement le camelCase en snake_case).

## Format de fichier `.graft`

```jsonc
{
  "version": 1,
  "dbPath": "/chemin/vers/base.sqlite",   // ou null
  "nodes": [
    {
      "id": "block-...",
      "position": { "x": 80, "y": 80 },
      "data": {
        "title": "Query 1",
        "blockType": "query",
        "sql": "SELECT 1;",
        "status": "idle",                  // toujours réinitialisé à la sauvegarde
        "result": null,
        "error": null
      }
    }
  ],
  "edges": [ { "id": "...", "source": "block-a", "target": "block-b" } ]
}
```

## Prérequis & commandes

**Prérequis :** Node + pnpm, Rust stable (+ prérequis Tauri de l'OS).

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

- Éditeur = `textarea` (Monaco prévu v0.2).
- Seul **SQLite** est branché (Postgres/MySQL en v0.3) — mais `sqlx` est déjà
  choisi pour une API unifiée.
- Les arêtes entre blocs sont dessinables mais n'ont pas encore de sémantique
  d'exécution (ordre/dépendances) — à définir avec la granularité des blocs.
