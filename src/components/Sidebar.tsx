import { useMemo, useState } from "react";
import { useGraftStore, type SqlNode } from "../store/useGraftStore";
import { insertIntoEditor } from "../canvas/editorRegistry";
import { BlockContextMenu, type MenuAction } from "../canvas/BlockContextMenu";
import { askConfirm } from "../dialogs/appDialogs";
import {
  describeIndex,
  describeRoutine,
  describeTrigger,
  explorerSections,
  hasMatchingColumn,
  objectKey,
} from "./schemaTree";
import type { BlockType, RoutineInfo, TableInfo, TriggerInfo } from "../types";

const BADGE_LETTER: Record<BlockType, string> = {
  query: "q",
  migration: "m",
  procedure: "p",
  trigger: "t",
  view: "v",
  script: "s",
};

type SectionId = "tables" | "views" | "triggers" | "routines";

const SECTION_LABEL: Record<SectionId, string> = {
  tables: "Tables",
  views: "Views",
  triggers: "Triggers",
  routines: "Procedures & functions",
};

/** Sections shown open until the user folds them. */
const INITIALLY_OPEN: Record<SectionId, boolean> = {
  tables: true,
  views: true,
  triggers: false,
  routines: false,
};

interface MenuState {
  x: number;
  y: number;
  actions: MenuAction[];
}

/**
 * Canvas sidebar: schema explorer (tables, views, triggers, procedures and
 * functions, introspected from the active connection, with a search filter)
 * + favorites + block list. Double-clicking a table/view opens a `SELECT`
 * block, a column inserts `table.column` into the focused block, a trigger or
 * routine opens its definition in a new block.
 */
export function Sidebar() {
  // Subscribe to the raw nodes array (stable reference), then derive the
  // filtered list in a memo. Filtering INSIDE the selector would return a
  // fresh array each call, which Object.is compares as "changed" and pushes
  // Zustand into an infinite re-render loop (blank screen).
  const allNodes = useGraftStore((s) => s.nodes);
  const nodes = useMemo(
    () => allNodes.filter((n): n is SqlNode => n.type === "sqlBlock"),
    [allNodes],
  );
  const dbSchema = useGraftStore((s) => s.dbSchema);
  const schemaObjects = useGraftStore((s) => s.schemaObjects);
  const hasConnection = useGraftStore((s) => s.connection !== null);
  const schemaError = useGraftStore((s) => s.schemaError);
  const refreshSchema = useGraftStore((s) => s.refreshSchema);
  const focusedBlockId = useGraftStore((s) => s.focusedBlockId);
  const addSelectBlock = useGraftStore((s) => s.addSelectBlock);
  const openSqlBlock = useGraftStore((s) => s.openSqlBlock);
  const addTableNode = useGraftStore((s) => s.addTableNode);
  const snippets = useGraftStore((s) => s.snippets);
  const insertSnippetRef = useGraftStore((s) => s.insertSnippetRef);
  const addBlockFromSnippet = useGraftStore((s) => s.addBlockFromSnippet);
  const deleteSnippet = useGraftStore((s) => s.deleteSnippet);

  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState(INITIALLY_OPEN);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);

  const sections = useMemo(
    () => explorerSections(dbSchema, schemaObjects, query),
    [dbSchema, schemaObjects, query],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const isEmpty = dbSchema.length === 0 && schemaObjects.routines.length === 0;
  const matchCount =
    sections.tables.length + sections.views.length + sections.triggers.length + sections.routines.length;

  const toggleSection = (id: SectionId) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  const toggleExpanded = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  // A search hit on a column unfolds its table so the hit is visible.
  const isRelationExpanded = (t: TableInfo) =>
    expanded[objectKey(t)] || hasMatchingColumn(t, normalizedQuery);

  const insert = (text: string) => {
    if (focusedBlockId) insertIntoEditor(focusedBlockId, text);
  };

  const openRelationMenu = (e: React.MouseEvent, relation: TableInfo) => {
    e.preventDefault();
    const actions: MenuAction[] = [
      { label: "SELECT * → new block", onClick: () => addSelectBlock(relation.name, relation.schema) },
      { label: "Add to canvas", onClick: () => addTableNode(relation.name, relation.schema) },
      {
        label: "Insert name into focused block",
        onClick: () => insert(objectKey(relation)),
        disabled: !focusedBlockId,
      },
    ];
    if (relation.definition) {
      actions.push({
        label: "Open definition → new block",
        onClick: () => openSqlBlock(`View ${objectKey(relation)}`, relation.definition ?? "", "view"),
      });
    }
    setMenu({ x: e.clientX, y: e.clientY, actions });
  };

  const openTrigger = (trigger: TriggerInfo) =>
    openSqlBlock(`Trigger ${objectKey(trigger)}`, trigger.definition, "trigger");
  const openRoutine = (routine: RoutineInfo) =>
    openSqlBlock(`${routine.kind === "procedure" ? "Procedure" : "Function"} ${objectKey(routine)}`, routine.definition, "procedure");

  const sectionHeader = (id: SectionId, count: number) => (
    <div className="schema-section" onClick={() => toggleSection(id)}>
      <span className="schema-row__caret">{openSections[id] ? "▾" : "▸"}</span>
      <span className="schema-section__label">{SECTION_LABEL[id]}</span>
      <span className="schema-tag">{count}</span>
    </div>
  );

  const relationRow = (relation: TableInfo) => {
    const key = objectKey(relation);
    const open = isRelationExpanded(relation);
    const foreignKeyColumns = new Set(relation.foreign_keys.map((fk) => fk.column));
    return (
      <div key={key}>
        <div
          className="schema-row"
          onClick={() => toggleExpanded(key)}
          onContextMenu={(e) => openRelationMenu(e, relation)}
          title="Click to expand · double-click for a SELECT block · right-click for more"
        >
          <span className="schema-row__caret">{open ? "▾" : "▸"}</span>
          <span
            className="schema-row__name"
            onDoubleClick={(e) => {
              e.stopPropagation();
              addSelectBlock(relation.name, relation.schema);
            }}
          >
            {key}
          </span>
          <span className="schema-tag">{relation.columns.length}</span>
        </div>
        {open && (
          <div className="schema-cols">
            {relation.columns.map((col) => (
              <div
                key={col.name}
                className="schema-col"
                title={`Insert "${relation.name}.${col.name}" into the focused block`}
                onDoubleClick={() => insert(`${relation.name}.${col.name}`)}
              >
                <span className="schema-col__name">{col.name}</span>
                {col.pk && <span className="schema-flag schema-flag--pk">PK</span>}
                {foreignKeyColumns.has(col.name) && <span className="schema-flag schema-flag--fk">FK</span>}
                {col.notnull && !col.pk && <span className="schema-flag">NN</span>}
                <span className="schema-col__type">{col.data_type}</span>
              </div>
            ))}
            {(relation.indexes ?? []).map((index) => (
              <div key={`index-${index.name}`} className="schema-detail" title={index.name}>
                <span className="schema-detail__kind">idx</span> {describeIndex(index)}
              </div>
            ))}
            {relation.foreign_keys.map((fk, i) => (
              <div key={`fk-${i}`} className="schema-detail">
                <span className="schema-detail__kind">fk</span> {fk.column} → {fk.to_table}
                {fk.to_column && `.${fk.to_column}`}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar__row">
        <span className="label">Schema</span>
        <button
          className="btn sidebar__refresh"
          title="Refresh schema"
          onClick={() => void refreshSchema()}
          disabled={!hasConnection}
        >
          ↻
        </button>
      </div>
      <input
        className="schema-search"
        placeholder="Search tables, columns, routines…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="sidebar__scroll">
        {!hasConnection && <span className="text-muted">No database connected</span>}
        {schemaError && <span className="sidebar__error">{schemaError}</span>}
        {hasConnection && !schemaError && isEmpty && (
          <span className="text-muted">Empty schema — create a table.</span>
        )}
        {!isEmpty && normalizedQuery && matchCount === 0 && (
          <span className="text-muted">No match for “{query}”.</span>
        )}

        {sections.tables.length > 0 && sectionHeader("tables", sections.tables.length)}
        {openSections.tables && sections.tables.map(relationRow)}

        {sections.views.length > 0 && sectionHeader("views", sections.views.length)}
        {openSections.views && sections.views.map(relationRow)}

        {sections.triggers.length > 0 && sectionHeader("triggers", sections.triggers.length)}
        {openSections.triggers &&
          sections.triggers.map((trigger) => (
            <div
              key={`trigger-${objectKey(trigger)}-${trigger.table}`}
              className="schema-object"
              title="Double-click to open the definition in a new block"
              onDoubleClick={() => openTrigger(trigger)}
            >
              <span className="schema-object__name">{objectKey(trigger)}</span>
              <span className="schema-object__detail">{describeTrigger(trigger)}</span>
            </div>
          ))}

        {sections.routines.length > 0 && sectionHeader("routines", sections.routines.length)}
        {openSections.routines &&
          sections.routines.map((routine, i) => (
            <div
              key={`routine-${objectKey(routine)}-${i}`}
              className="schema-object"
              title="Double-click to open the definition in a new block"
              onDoubleClick={() => openRoutine(routine)}
            >
              <span className="schema-object__name">
                <span className="schema-flag">{routine.kind === "procedure" ? "proc" : "fn"}</span>{" "}
                {routine.schema ? `${routine.schema}.` : ""}
                {describeRoutine(routine)}
              </span>
            </div>
          ))}
      </div>

      <div className="sep sep--h" />
      <div className="label">Favorites ({snippets.length})</div>
      <div className="sidebar__blocks">
        {snippets.length === 0 && (
          <span className="text-muted">Right-click a block → “Save as favorite…”</span>
        )}
        {snippets.map((s) => (
          <div
            key={s.id}
            className="sidebar__block"
            title={
              focusedBlockId
                ? `Double-click to insert {{${s.name}}} · right-click to remove`
                : `Double-click to open as a block · right-click to remove`
            }
            onDoubleClick={() =>
              focusedBlockId ? insertSnippetRef(s.id) : addBlockFromSnippet(s.id)
            }
            onContextMenu={async (e) => {
              e.preventDefault();
              const isConfirmed = await askConfirm({
                title: "Remove favorite",
                message: `Remove “${s.name}”? Blocks referencing {{${s.name}}} will no longer expand it.`,
                okLabel: "Remove",
                isDanger: true,
              });
              if (isConfirmed) deleteSnippet(s.id);
            }}
          >
            <span className={`badge badge--${s.blockType}`}>{BADGE_LETTER[s.blockType]}</span>
            <span className="sidebar__block-name">{`{{${s.name}}}`}</span>
          </div>
        ))}
      </div>

      <div className="sep sep--h" />
      <div className="label">Blocks ({nodes.length})</div>
      <div className="sidebar__blocks">
        {nodes.length === 0 && <span className="text-muted">No blocks yet</span>}
        {nodes.map((n) => (
          <div
            key={n.id}
            className={`sidebar__block ${focusedBlockId === n.id ? "is-active" : ""}`}
            title={n.data.title}
          >
            <span className={`badge badge--${n.data.blockType}`}>{BADGE_LETTER[n.data.blockType]}</span>
            <span className="sidebar__block-name">{n.data.title}</span>
          </div>
        ))}
      </div>

      {menu && (
        <BlockContextMenu x={menu.x} y={menu.y} actions={menu.actions} onClose={() => setMenu(null)} />
      )}
    </aside>
  );
}
