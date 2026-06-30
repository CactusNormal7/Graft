# Graft — Brief de design system

> Document d'entrée ayant servi à concevoir le design system.
> **Statut : réalisé.** Le DS et le wireframe ont été produits dans **Claude
> Design** (projet « Wireframe application design ») et implémentés dans l'app :
> tokens dans `src/styles/tokens/`, coquille dans `src/styles/app.css`. Voir
> `docs/technique.md` § Design system et la mémoire `design-system`.
> Ce brief reste la référence d'intention ; le DS Claude Design fait foi pour les
> valeurs exactes.

## 1. Le produit en une ligne

Graft est un **IDE de base de données SQL sur canvas infini**, application desktop
(macOS + Windows), pour **développeurs et DBAs**. Ambition de complétude type
**DBeaver / DataGrip**, mais dont la colonne vertébrale est un **canvas spatial**
de blocs SQL.

## 2. Public & contexte → ce que ça impose au design

Audience technique (devs/DBAs) qui passe ses journées dans des IDE et des
terminaux. Le design doit donc être :

- **Dense, pas aéré** : maximiser l'information utile à l'écran (façon IDE), pas
  l'esthétique « landing page ». Petites tailles de police, paddings serrés.
- **Sombre par défaut** (thème clair en option) — convention forte du public.
- **Sobre et professionnel** : zéro fioriture, pas d'illustrations marketing,
  pas d'animations spectaculaires. La donnée et le code sont les héros.
- **Clavier d'abord** : raccourcis, palette de commandes, focus visibles.
- **Natif sur chaque OS** : respecter les conventions macOS (menu bar système,
  feux tricolores) et Windows (menus de fenêtre, contrôles), sans imposer un look
  « web » dépaysant.

**Mots-clés de personnalité** : technique, précis, calme, dense, fiable.
**À éviter** : ludique, coloré-pastel, arrondi-bulle, « friendly SaaS ».

## 3. Principes de design

1. **L'information avant la décoration.** Chaque pixel sert la lecture du SQL,
   du schéma ou des données.
2. **Le canvas est la colonne vertébrale.** Les surfaces classiques (explorateur,
   grille, console) s'organisent *autour* de lui, sans le reléguer en gadget.
3. **Cohérence des surfaces.** Un même langage visuel pour les nœuds du canvas,
   les panneaux latéraux et les grilles de données.
4. **Densité réglable.** Prévoir une échelle de densité (compact / confortable).
5. **États toujours lisibles.** running / succès / erreur / vide doivent être
   immédiatement distinguables, y compris pour les daltoniens (couleur + icône).

## 4. Couleurs

Base sombre déjà amorcée dans le code (à raffiner, pas à jeter) :

| Rôle | Token | Valeur actuelle |
|------|-------|-----------------|
| Fond app / canvas | `--bg` | `#0f1117` |
| Surface panneau | `--panel` | `#1a1d27` |
| Surface élevée | `--panel-2` | `#232733` |
| Bordure | `--border` | `#2d3242` |
| Texte principal | `--text` | `#e6e8ee` |
| Texte secondaire | `--muted` | `#8b91a3` |
| Accent / interactif | `--accent` | `#6ea8fe` |
| Erreur | `--error` | `#ff6b6b` |

À compléter par le design system :
- **Sémantiques** : succès, avertissement, info, danger (+ leurs variantes fond/texte).
- **Palette par type de bloc** (déjà esquissée, à harmoniser) : `query`, `migration`,
  `procedure`, `trigger`, `view`, `script` — chaque type a une couleur d'accent
  reconnaissable mais désaturée (pas criarde).
- **Couleurs « données »** pour les grilles : null, types numériques/texte/date,
  lignes modifiées/insérées/supprimées (diff d'édition de données).
- **Thème clair** équivalent, mappé sur les mêmes tokens sémantiques.
- Contraste **AA minimum** sur texte et états.

## 5. Typographie

- **UI** : sans-serif système (San Francisco / Segoe UI / Inter) — neutre, lisible
  en petites tailles.
- **Code & données** : monospace (SF Mono / JetBrains Mono / Menlo) pour tout le
  SQL, les noms d'objets de schéma et les cellules de la grille.
- Échelle compacte : ~11–13px pour l'UI dense, hiérarchie par graisse plutôt que
  par grande taille.

## 6. Espacement, grille, densité

- Échelle d'espacement basée 4px (4 / 8 / 12 / 16…).
- Rayons de coin discrets (4–10px), pas de gros arrondis.
- Hauteurs de lignes/contrôles compactes (barres d'outils ~28–32px, lignes de
  table ~22–26px).
- Mode densité **compact / confortable** commutable.

## 7. Élévation & surfaces

Système de couches clair : fond (canvas) < panneaux < éléments flottants
(toolbars, popovers, modales). Élévation exprimée surtout par la **couleur de
surface** (`--panel` → `--panel-2`) et des **bordures fines**, ombres très
discrètes (cohérent avec un look IDE plat).

## 8. Iconographie

- Jeu d'icônes **linéaires, fines, monochromes** (style Lucide / Phosphor),
  taille 16px par défaut.
- Icônes dédiées par **type d'objet de schéma** (table, vue, colonne, clé,
  index, trigger, procédure) et par **type de bloc**.
- Cohérence : une seule famille d'icônes pour toute l'app.

## 9. Architecture de l'écran (coquille applicative)

Layout cible (à designer) :

```
┌──────────────────────────────────────────────────────────┐
│  Barre de menus native (Fichier · Édition · Affichage · …) │  ← natif OS
├───────────┬──────────────────────────────────────────────┤
│           │  Barre d'outils contextuelle / onglets         │
│  Sidebar  ├──────────────────────────────────────────────┤
│           │                                                │
│  - Connex.│                                                │
│  - Schéma │            SURFACE CENTRALE                    │
│  - Notebk │       (Canvas par défaut ; ou grille de        │
│           │        données / console SQL / diagramme ER)   │
│           │                                                │
├───────────┴──────────────────────────────────────────────┤
│  Barre de statut (connexion active · moteur · curseur · …) │
└──────────────────────────────────────────────────────────┘
```

- **Sidebar** : gestionnaire de **connexions** (multi-moteur : Postgres / MySQL /
  SQLite), **explorateur de schéma** (arbre tables/vues/colonnes/…), navigation
  entre notebooks/vues. Pliable, redimensionnable.
- **Surface centrale** : le **canvas** par défaut ; à terme commutable vers
  grille de données, console SQL, diagramme ER.
- **Barre de statut** en bas : connexion active, moteur, état d'exécution, etc.
- Penser **panneaux dockables / redimensionnables** (split views) façon IDE.

## 10. Langage visuel du canvas (spécifique Graft)

- **Nœud = bloc SQL** : en-tête (badge de type coloré + titre + bouton Run +
  menu), corps = éditeur de code, pied = résultats inline (table) ou erreur.
- **Points de connexion (handles)** discrets, plus visibles au survol.
- **Arêtes** : style propre selon la sémantique future (dépendance / ordre /
  flux) — prévoir au moins deux styles distinguables.
- **Fond de canvas** : grille à points subtile, non distrayante.
- **Minimap** et **contrôles de zoom** intégrés au thème.
- États du nœud : idle / running (indicateur de progression) / succès / erreur,
  reflétés sur la bordure ou l'en-tête.

## 11. Composants à spécifier

Boutons (primaire/secondaire/ghost/danger, tailles) · champs & selects · onglets ·
arbre (explorateur de schéma) · **grille de données éditable** (tri, redimension,
sélection, édition inline, pagination/virtualisation) · toolbar · menus
contextuels (clic droit) · **palette de commandes** (Cmd/Ctrl-K) · modales ·
toasts/notifications · tooltips · badges/chips · barre de statut · états de
**chargement** (skeletons/spinners) et **états vides** (canvas vide, aucune
connexion, résultat sans ligne).

## 12. Motion

Animations **rapides et fonctionnelles** (transitions 120–180ms), uniquement pour
clarifier (ouverture de panneau, feedback d'exécution). Pas d'effets décoratifs.

## 13. Accessibilité & plateformes

- Contraste AA, focus clavier visibles partout, navigation 100% clavier possible.
- Couleur **jamais seule porteuse de sens** (toujours doublée d'une icône/texte).
- Respect des conventions natives macOS vs Windows (menus, raccourcis, contrôles
  de fenêtre).

## 14. Livrables attendus du design system

1. **Design tokens** (couleurs, typo, espacement, rayons, élévation) en thèmes
   sombre **et** clair, exportables en variables CSS.
2. **Bibliothèque de composants** (cf. §11) avec tous leurs états.
3. **Langage du canvas** : nœud de bloc (par type + par état), arêtes, handles,
   fond, minimap.
4. **Maquettes des écrans clés** : app shell complète, canvas peuplé, explorateur
   de schéma, grille de données, console SQL, gestionnaire de connexions, palette
   de commandes, états vides.
5. **Jeu d'icônes** cohérent (objets de schéma + types de blocs).
