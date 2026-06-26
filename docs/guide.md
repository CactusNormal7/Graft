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

1. **Connect SQLite…** (barre du haut) → choisis un fichier `.db` / `.sqlite`.
   S'il n'existe pas, il est **créé automatiquement**. Le nom de la base
   connectée s'affiche ensuite dans le bouton.
2. **Add block** → choisis un type (`query`, `migration`, `procedure`,
   `trigger`, `view`, `script`). Le bloc apparaît sur le canvas.
3. Écris ton SQL dans le bloc, puis clique **▶ Run**.
   - Une requête de lecture affiche une **table de résultats** (+ nb de lignes
     et temps en ms).
   - Une écriture/DDL affiche le **nombre de lignes affectées**.
   - Une erreur s'affiche en rouge dans le bloc.
4. **Déplace** les blocs librement, **relie-les** en tirant depuis le point de
   connexion droit vers le point gauche d'un autre bloc.
5. **Save** → enregistre le canvas dans un fichier `.graft` (JSON).
   **Open** → recharge un `.graft` existant.

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

- L'éditeur SQL est un simple champ texte (la coloration + autocomplétion
  Monaco arrivent en v0.2).
- Seul **SQLite** est supporté (Postgres/MySQL en v0.3).
- Les liens entre blocs sont visuels uniquement (pas encore d'ordre
  d'exécution).
