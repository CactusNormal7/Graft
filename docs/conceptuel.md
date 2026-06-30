# Graft — Explication conceptuelle

> Document vivant. Mis à jour à chaque évolution du concept (voir la règle dans `CLAUDE.md`).
> Dernière mise à jour : v0.1 (POC).

## Vision en une phrase

Graft est un **éditeur de base de données SQL sur canvas infini** : on remplace le
défilement linéaire d'un notebook (type Jupyter) par une **organisation spatiale**.
Les blocs SQL sont posés librement sur un tableau blanc et reliés visuellement
entre eux et aux objets du schéma.

## Pour qui

**Développeurs et DBAs** — pas les data analysts ni les utilisateurs BI.

C'est le **différenciateur** de Graft face aux outils canvas existants
(Count.co, Hex, Mode, Deepnote), qui sont conçus pour l'analytique et
l'exploration de données. Graft vise le **travail bas niveau** sur la base :
migrations, procédures stockées, triggers, vues — pas la production de dashboards.

## Ambition & cadrage produit

Graft est pensé comme un outil **LOURD au sens « complet »** (pas lent) : la cible
d'exhaustivité est celle d'un **DBeaver ou d'un DataGrip** — un véritable IDE de
base de données, pas un mini-éditeur. Ce qui implique, à terme : gestionnaire de
connexions, arbre/explorateur de schéma, grille d'édition de données, console SQL,
import/export, diagrammes ER, gestion des droits, etc.

**Tension stratégique à garder en tête :** DBeaver/DataGrip ne sont *pas* des
outils canvas — ce sont des arbres + onglets + grilles. Si Graft vise leur
complétude **plus** le canvas, le risque est de devenir « un DBeaver avec un
canvas collé dessus » et de diluer le différenciateur. Ligne directrice : le
**canvas reste la colonne vertébrale** du produit (la façon dont on pense la base
spatialement), et les surfaces classiques d'un IDE DB s'organisent *autour* de lui,
pas l'inverse.

Concrètement, Graft devient une **coquille applicative complète** (app desktop
classique), pas seulement un canvas plein écran :
- **barre latérale** (sidebar) : connexions, explorateur de schéma, navigation ;
- **barre de menus native** en haut (Fichier, Édition, Affichage, Fenêtre…),
  façon application desktop classique, sur **macOS et Windows** ;
- le canvas comme **surface centrale** parmi d'autres vues, pas comme l'app entière.

> Le squelette v0.1 actuel est volontairement minimal (canvas quasi nu) et **sera
> revu** pour accueillir cette coquille. La direction design passera plus tard par
> Claude Design.

## Le modèle de blocs

Un **bloc** est une unité de SQL posée sur le canvas. Six types prévus :

| Type | Usage |
|------|-------|
| `query` | requête de lecture/écriture ponctuelle |
| `migration` | évolution de schéma (CREATE/ALTER…) |
| `procedure` | procédure stockée |
| `trigger` | déclencheur |
| `view` | vue |
| `script` | script SQL libre |

Les blocs peuvent être **connectés** entre eux et (à terme) aux **objets de schéma**
(tables, colonnes). C'est précisément pourquoi le canvas repose sur un vrai modèle
de graphe nœuds/arêtes (React Flow) plutôt qu'un whiteboard de dessin libre.

## Ce que Graft n'est PAS (non-goals)

- Pas un outil de BI ni un constructeur de dashboards
- Pas un ORM / query builder no-code
- Pas collaboratif temps réel en v1 (mais l'architecture ne doit pas l'empêcher
  plus tard, ex. via CRDTs)

## Questions ouvertes (non tranchées)

- **Granularité d'un bloc** : un statement ? un fichier de migration ? un « sujet »
  (tout ce qui touche une table donnée) ?
- **Modèle économique** : cœur open source + fonctions pro payantes, ou full commercial ?
- **Persistance** : fichiers `.graft` (JSON, diff-friendly avec Git) vs. SQLite
  embarqué (meilleur pour la recherche plein texte transverse, prévue comme
  fonctionnalité cœur) — peut-être les deux. *(v0.1 implémente le JSON.)*
- **Éditeur SQL** : Monaco vs. CodeMirror 6.
- **GraphQL** : à l'étude. Interprétation et avis détaillés dans
  `docs/technique.md` § GraphQL. En résumé : pertinent comme **fonctionnalité**
  (générer/exposer une API GraphQL depuis le schéma, type PostGraphile/Hasura),
  à phaser tard et en module ; **à proscrire** comme transport interne
  frontend↔backend (les commandes Tauri natives suffisent).

## Trajectoire (roadmap)

- **v0.1 (POC)** — canvas + blocs SQL déplaçables, connexion SQLite locale,
  exécution inline, sauvegarde notebook JSON. ✅ *en place*
- **v0.2** — éditeur riche **CodeMirror 6** (coloration, autocomplétion
  tables/colonnes, Ctrl/Cmd+Entrée), erreurs inline. 🔶 *en cours* (l'éditeur,
  la coloration et l'autocomplétion schéma SQLite sont en place).
- **v0.3** — explorateur de schéma, connexions visuelles blocs ↔ tables,
  support Postgres + MySQL.
- **v1.0** — UX canvas peaufinée (zoom, groupes, zones nommées), types de blocs
  différenciés, export de notebook, distribution desktop Tauri.
