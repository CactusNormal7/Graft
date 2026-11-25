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

### Optionnel : serveur de langage SQL

```bash
pnpm lsp:install
```

Installe [`sql-language-server`](https://github.com/joe-re/sql-language-server)
dans ton dossier de données utilisateur. Graft le détecte au lancement et
l'utilise pour enrichir l'autocomplétion et signaler quelques problèmes
(soulignés en pointillé, niveau « info »). Sans lui, tout fonctionne avec
l'autocomplétion intégrée. Note : ce serveur écrit un journal
(`sql-language-server.log` dans le dossier temporaire) contenant le SQL des
blocs ; Graft ne lui transmet jamais de connexion ni de mot de passe.

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
  - **Moteur** : **SQLite**, **PostgreSQL** ou **MySQL** (MariaDB compris).
    - SQLite : **Database file** → *Browse* pour pointer un fichier
      `.db`/`.sqlite` **existant**, ou laisse vide pour créer un nouveau
      `<nom>.db` à côté du projet.
    - PostgreSQL / MySQL : **hôte**, **port** (5432 / 3306 par défaut),
      **base** (obligatoire pour MySQL ; pour Postgres, par défaut celle du
      nom d'utilisateur), **utilisateur**, **mot de passe** et **SSL**
      (*Disable*, *Prefer* — défaut, *Require*, *Verify* = vérification du
      certificat et du nom d'hôte). Le mot de passe est rangé dans le
      **trousseau du système** (Trousseau macOS, Gestionnaire d'identification
      Windows), **jamais** dans le fichier `.graft`.
  - **Test connection** vérifie la connexion et affiche la version du serveur
    (ou l'erreur) sans rien enregistrer.
  À la validation, le projet est **créé et sauvegardé immédiatement**
  (`<emplacement>/<nom>.graft`), puis tu entres dans le canvas. Si un projet du
  même nom existe déjà à cet emplacement, la création est **refusée** (il n'est
  jamais écrasé) : ouvre-le ou choisis un autre nom. Le nom ne peut pas contenir
  de séparateur de chemin ni les caractères interdits par Windows
  (`: * ? " < > |`).
- **Projets récents** → liste persistée ; clique pour **rouvrir**, ✕ pour retirer
  de la liste.
- **Open file…** → ouvre un `.graft` existant où qu'il soit.

> **Changer de connexion** : dans un projet ouvert, clique sur le bouton de
> connexion de la toolbar (à droite du nom du projet). Il passe au **rouge**
> si la base est injoignable (le message s'affiche dans la sidebar). Laisse le
> mot de passe vide pour garder celui déjà enregistré. Sur Postgres/MySQL,
> Graft garde **une** connexion ouverte par projet : un `SET`, une table
> temporaire ou une transaction ouverte dans un bloc reste visible des
> suivants, comme dans une console.

> 💡 Le dossier `data/` est ignoré par Git (certains jeux de données dépassent
> la limite de GitHub) : aucune base d'exemple n'est versionnée. Pointe un
> projet vers ta propre base `.db`/`.sqlite`, ou laisse Graft en créer une vide.

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
   - Une erreur s'affiche en rouge dans le bloc, et l'endroit fautif est
     **souligné dans l'éditeur** (survole-le pour relire le message). La
     position vient du moteur quand il la donne, sinon du mot cité dans le
     message ; à défaut, la première ligne est soulignée. Le soulignement
     disparaît dès que tu modifies le SQL.
3. **Actions par bloc** dans le header :
   - **Formater le SQL** : **Shift+Alt+F** (⇧⌥F sur Mac) dans l'éditeur, ou
     clic droit → **Format SQL**, ou la palette ⌘K. Mise en forme selon le
     dialecte du moteur, mots-clés en majuscules ; les `{{favoris}}` sont
     préservés ; annulable par Ctrl/Cmd+Z. Un SQL invalide est laissé tel quel.
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
     affichée, sélecteur **50 / 100 / 500 / All**). Purement côté client. La
     barre reste visible dès que la taille de page choisie découpe le résultat.
   - **⇥** route le résultat vers un **bloc lié** (créé à droite au premier
     Run, connecté par une arête). Utile quand le résultat prend beaucoup
     de place ou qu'on veut le comparer à côté.
   - **▾ / ▸** replie le bloc sur son **header** (badge, nom renommable et
     bouton Run uniquement) — pratique pour dégager le canvas. Aussi dans le
     menu contextuel.
   - **⧉** duplique le bloc à côté.
   - **✕** supprime le bloc (et son bloc résultat lié, le cas échéant).
   - **Clic droit sur le bloc** ouvre un menu contextuel (Run, Duplicate,
     Rename, Collapse, Save as favorite…, Copy SQL, changement de vue, toggle
     bloc-lié, génération d'INSERT, Delete).
   - **Clic droit sur une cellule ou une ligne** de résultat : copies
     (valeur, colonne, ligne en JSON/INSERT/TSV) et snippets SQL (clause
     `WHERE`, `SELECT` filtré, template `UPDATE`), plus des actions qui
     **ouvrent le SQL dans un nouveau bloc**, à relire puis exécuter (rien
     n'est modifié directement) :
     - cellule : **Set NULL → new block** (`UPDATE … SET col = NULL WHERE <clé>`),
       **Open row in new block** (`SELECT * … WHERE <clé>`) ;
     - ligne : **Open row in new block**, **Duplicate row → new block**
       (`INSERT` d'une copie ; une clé `INTEGER PRIMARY KEY` est laissée à la
       base, une autre clé est recopiée et doit être modifiée),
       **Delete row → new block** (`DELETE … WHERE <clé>`).

     Elles ne s'activent que si le résultat correspond **sans ambiguïté à une
     seule table** (toutes les colonnes en viennent) **et contient sa clé
     primaire** — typiquement un `SELECT * FROM table`. Sinon elles sont grisées
     et leur infobulle dit pourquoi (jointure, clé primaire non sélectionnée,
     table sans clé primaire…). Dans ce cas les copies utilisent aussi le vrai
     nom de table au lieu du placeholder `«table»`.
   - **Redimensionnement** : sélectionne un bloc, les poignées apparaissent
     sur les bords/coins ; taille persistée dans le fichier `.graft`.
4. **Sidebar — explorateur de schéma** : sections **Tables**, **Views**,
   **Triggers** et **Procedures & functions** de la base connectée (SQLite,
   PostgreSQL ou MySQL). Clique **▸** pour dérouler une table : colonnes avec
   leur type et les badges **PK** (clé primaire), **FK** (clé étrangère),
   **NN** (non nul), puis ses **index** et **clés étrangères**. Tape dans
   **Search…** pour filtrer (noms, colonnes, routines) — les tables dont une
   colonne matche se déploient automatiquement. **↻** relance l'introspection.
   **Clic droit** sur une table/vue : SELECT, insertion du nom, **définition**
   d'une vue dans un nouveau bloc. **Double-clic** sur un trigger ou une
   procédure/fonction : sa **définition** s'ouvre dans un nouveau bloc.
   **Double-clic sur un nom de table** crée automatiquement un bloc
   `SELECT * FROM <table> LIMIT 100;` sur le canvas et l'exécute aussitôt.
   **Double-clic sur une colonne** insère `table.colonne` au curseur du bloc
   actif (le dernier éditeur focalisé — surligné dans la liste « Blocks »).
5. **Tables sur le canvas** : clic droit sur une table dans la sidebar →
   **Add to canvas**, ou palette ⌘K / menu **View** → **Add referenced
   tables to canvas** (ajoute à gauche des blocs toutes les tables que leur
   SQL utilise). Chaque bloc est alors **relié en pointillé** aux tables qu'il
   lit ou écrit (`FROM`, `JOIN`, `INSERT INTO`, `UPDATE`, `CREATE TABLE`,
   `REFERENCES`, `ON` d'un index/trigger). Ces liens suivent le SQL tout seuls
   et ne se suppriment pas à la main ; ils sont purement visuels. **✕** sur
   une table la retire du canvas (la table elle-même n'est pas touchée) ;
   double-clic sur son en-tête ouvre un bloc `SELECT`.
6. **+ Group** (toolbar) crée un **conteneur coloré**. Fais glisser des blocs
   à l'intérieur pour les y attacher : déplacer le groupe déplace alors tous ses
   blocs. Sors un bloc du cadre pour le détacher. Le header du groupe permet de
   **renommer** (double-clic), **changer la couleur** (pastille) et **supprimer**
   le groupe (✕ — les blocs contenus sont conservés, seulement détachés).
   *(Suppression au clavier désactivée : utilise les boutons ✕ des blocs/groupes
   pour que les cascades — bloc résultat lié, détachement — s'exécutent.)*
7. **▶ Run all** (toolbar) exécute tous les blocs dans l'ordre.
8. **Déplace** les blocs librement, **relie-les** en tirant depuis le point de
   connexion droit vers le point gauche d'un autre bloc.
9. **Pages (onglets type Excel)** : la barre en bas du canvas liste les pages,
   chacune avec son propre canvas de blocs/groupes. **Clic** pour changer de
   page, **double-clic** pour renommer, **clic droit** pour supprimer, **+**
   pour en ajouter. Toutes les pages sont enregistrées dans le même `.graft`.
10. **Save** (ou **⌘S / Ctrl+S**) → enregistre le projet (toutes les pages)
   dans son fichier `.graft` (JSON). Un **point orange** après le nom du projet
   (et « Save ● ») signale des **modifications non sauvegardées** — SQL,
   position/taille des blocs, pages, favoris… ; exécuter une requête n'en est
   pas une. Ouvrir ou créer un autre projet, fermer la fenêtre ou quitter
   l'app demande alors confirmation. Le clic sur **graft** (en haut à gauche)
   revient à l'accueil sans fermer le projet : **↩ Back to <projet>** y ramène.
11. Zoom via la toolbar (`−` / `+` / `⊞` pour ajuster) ou la molette ; **minimap**
   en bas à droite.

### Blocs favoris & sous-requêtes (`{{nom}}`)
- **Enregistrer un favori** : clic droit sur un bloc → **« Save as favorite… »**,
  puis choisis un nom dans la fenêtre qui s'ouvre (Entrée pour valider, Échap
  pour annuler). Clic droit sur un favori de la sidebar → confirmation, puis
  suppression. Les favoris sont listés dans la sidebar et enregistrés
  dans le `.graft`. Le nom est normalisé pour être référençable : seuls lettres,
  chiffres, `_`, `.` et `-` sont gardés, le reste devient `_` (« Query 1 » →
  `Query_1`).
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
- **⌘K / Ctrl+K** ouvre la **barre d'actions** : tape pour filtrer les
  **commandes** (Format SQL, Run, New … block, Save, Zoom…, avec leur
  raccourci) et les **favoris** ; ↑/↓ pour naviguer, ↵ pour lancer la commande
  ou insérer la référence du favori dans le bloc focalisé (ou créer un bloc si
  aucun n'est focalisé).

### Données imbriquées ↔ INSERT multi-tables (ORM)
Une requête avec jointures donne une vue imbriquée (`{}`) — et cette vue est une
**vraie source de données** : tu peux la réinjecter sous forme d'INSERT.

- **Clic droit sur un bloc (ou son bloc résultat)** :
  - **Generate INSERTs → new block** — crée un bloc `script` contenant les
    INSERT. Si la relation est détectée, ce sont des INSERT **multi-tables** :
    un INSERT parent suivi de ses enfants, la clé étrangère étant renseignée
    automatiquement (valeur de la clé si elle est sélectionnée, sinon une
    sous-requête qui relit la clé de la dernière ligne parent insérée).
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

### Barre de menus
Graft a une vraie barre de menus (barre système sur macOS, menu de fenêtre
sur Windows). Raccourcis : **Cmd** sur macOS, **Ctrl** sur Windows.

| Action | macOS | Windows |
|--------|-------|---------|
| Nouveau projet | ⌘N | Ctrl+N |
| Ouvrir un projet | ⌘O | Ctrl+O |
| Enregistrer | ⌘S | Ctrl+S |
| Exécuter le bloc | ⌘↵ | Ctrl+Enter |
| Exécuter tous les blocs | ⌘⇧↵ | Ctrl+Shift+Enter |
| Formater le SQL | ⇧⌥F | Shift+Alt+F |
| Palette de commandes | ⌘K | Ctrl+K |
| Zoom + / − / ajuster | ⌘= / ⌘- / ⌘0 | Ctrl+= / Ctrl+- / Ctrl+0 |
| Accueil | ⌘⇧H | Ctrl+Shift+H |

**File ▸ New Block** crée un bloc de chaque type ; **New Group**, **New Page**,
**Import Data File…** et **View ▸ Refresh Schema** reprennent les boutons de
la toolbar. Les actions du canvas sont sans effet sur l'écran d'accueil.

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

## 5. Utiliser Graft avec Claude (MCP)

Graft fournit un **serveur MCP** (`graft-mcp`) : Claude Desktop ou Claude Code
peut alors lister tes projets, lire le schéma, lire/créer/modifier des blocs,
exécuter des requêtes **en lecture seule**, expliquer un plan d'exécution ou
générer des INSERT — **sans que l'app soit ouverte**.

1. Construis le serveur : `cd src-tauri && cargo build --release -p graft-mcp`.
2. Déclare-le dans `claude_desktop_config.json` (macOS :
   `~/Library/Application Support/Claude/`, Windows : `%APPDATA%\Claude\`) :
   ```json
   { "mcpServers": { "graft": { "command": "/chemin/vers/src-tauri/target/release/graft-mcp" } } }
   ```
3. Redémarre Claude Desktop.

Claude ne voit que les projets que tu as **ouverts au moins une fois dans
Graft**. Il ne peut **pas modifier la base** tant que tu n'as pas coché
**« Allow Claude (MCP) to modify this database »** dans la fenêtre
**Connection** (bouton de connexion de la toolbar) ; ce réglage reste sur ton
ordinateur, il n'est pas enregistré dans le fichier `.graft`. Les blocs que
Claude crée sont écrits dans le `.graft` : si le projet est ouvert dans Graft,
une fenêtre **« Project changed on disk »** propose de le **recharger** (et
prévient si tu as des modifications non sauvegardées). Si tu refuses puis
enregistres, Graft te demande confirmation avant d'**écraser** les changements
faits par Claude.

## 6. Construire un binaire distribuable

```bash
pnpm tauri build
```

Génère l'exécutable/installeur dans `src-tauri/target/release/` (et le bundle
`.app`/`.dmg` sur macOS).

## 7. Limites actuelles (v0.1)

- Éditeur SQL déjà bien avancé (CodeMirror 6 : coloration + autocomplétion
  schéma + gutter + brackets + `Mod-Enter` + erreurs soulignées + LSP
  optionnel + formatage).
- Une connexion par projet (pas encore de connexions nommées partagées).
- Les liens entre blocs sont visuels uniquement (pas d'ordre d'exécution).
