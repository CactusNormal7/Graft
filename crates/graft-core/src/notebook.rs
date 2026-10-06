//! Typed model of a `.graft` project file.
//!
//! Mirrors `NotebookFile` in `src/types.ts`. Rust consumers (the MCP server)
//! read any version (v1–v5) and can edit SQL blocks without losing data: every
//! struct keeps the fields it does not model in an `extra` map, and
//! `serde_json`'s `preserve_order` keeps key order, so a load → save round
//! trip is lossless and diffs stay minimal. New nodes are shaped exactly like
//! the app's (`newSqlNode` in `src/store/useGraftStore.ts`).

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::db::TableInfo;
use crate::files::{load_project_file, save_project_file};

/// Name given to the single page of a pre-v4 (flat) file, as in the app.
const LEGACY_PAGE_NAME: &str = "Page 1";
const LEGACY_PAGE_ID: &str = "page-1";

/// A saved favorite block, referenced as `{{name}}`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    pub name: String,
    pub sql: String,
    pub block_type: String,
}

/// A serialized canvas node (any kind). `data` stays untyped: its shape depends
/// on `type`; use [`NotebookNode::sql_block`] to read a SQL block.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NotebookNode {
    pub id: String,
    /// Absent in v1 files (all nodes were `sqlBlock`).
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default)]
    pub position: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub data: Map<String, Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// The user-facing parts of a SQL block.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SqlBlock {
    pub id: String,
    pub title: String,
    pub block_type: String,
    pub sql: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
}

impl NotebookNode {
    /// Node kind, defaulting to `sqlBlock` for v1 files.
    pub fn kind(&self) -> &str {
        self.kind.as_deref().unwrap_or("sqlBlock")
    }

    /// This node as a SQL block, or `None` for result blocks and groups.
    pub fn sql_block(&self) -> Option<SqlBlock> {
        if self.kind() != "sqlBlock" {
            return None;
        }
        let text = |key: &str| {
            self.data
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let block_type = text("blockType");
        Some(SqlBlock {
            id: self.id.clone(),
            title: text("title"),
            block_type: if block_type.is_empty() { "query".into() } else { block_type },
            sql: text("sql"),
            group_id: self.parent_id.clone(),
        })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NotebookPage {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub nodes: Vec<NotebookNode>,
    #[serde(default)]
    pub edges: Vec<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// On-disk shape of a `.graft` file, any version.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NotebookFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_db_type")]
    pub db_type: String,
    #[serde(default)]
    pub db_path: Option<String>,
    /// v5+: cached database structure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db_schema: Option<Vec<TableInfo>>,
    /// v5+: favorite blocks.
    #[serde(default)]
    pub snippets: Vec<Snippet>,
    /// v1–v3: a single flat canvas.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nodes: Option<Vec<NotebookNode>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edges: Option<Vec<Value>>,
    /// v4+: named pages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pages: Option<Vec<NotebookPage>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn default_version() -> u32 {
    1
}

fn default_db_type() -> String {
    "sqlite".into()
}

impl NotebookFile {
    /// Parse a notebook from its JSON text.
    pub fn parse(json: &str) -> Result<Self, String> {
        serde_json::from_str(json).map_err(|e| format!("invalid .graft file: {e}"))
    }

    /// The pages of this file. Pre-v4 flat files become a single "Page 1",
    /// like `pagesFromFile` in the app.
    pub fn pages(&self) -> Vec<NotebookPage> {
        match &self.pages {
            Some(pages) if !pages.is_empty() => pages.clone(),
            _ => vec![NotebookPage {
                id: LEGACY_PAGE_ID.into(),
                name: LEGACY_PAGE_NAME.into(),
                nodes: self.nodes.clone().unwrap_or_default(),
                edges: self.edges.clone().unwrap_or_default(),
                extra: Map::new(),
            }],
        }
    }
}

/// A SQL block together with the page it lives on.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PagedBlock {
    pub page_id: String,
    pub page_name: String,
    #[serde(flatten)]
    pub block: SqlBlock,
}

/// A loaded project: the file plus where it lives.
#[derive(Clone, Debug)]
pub struct Project {
    pub path: std::path::PathBuf,
    pub file: NotebookFile,
}

impl Project {
    /// Display name: the stored name, else the file stem.
    pub fn name(&self) -> String {
        if !self.file.name.is_empty() {
            return self.file.name.clone();
        }
        self.path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    /// Every SQL block, page by page. `page` filters by page id or name.
    pub fn blocks(&self, page: Option<&str>) -> Vec<PagedBlock> {
        self.file
            .pages()
            .into_iter()
            .filter(|p| page.is_none_or(|q| p.id == q || p.name == q))
            .flat_map(|p| {
                let (page_id, page_name) = (p.id, p.name);
                p.nodes
                    .iter()
                    .filter_map(|n| n.sql_block())
                    .map(|block| PagedBlock {
                        page_id: page_id.clone(),
                        page_name: page_name.clone(),
                        block,
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    /// The SQL block with this id, on any page.
    pub fn block(&self, block_id: &str) -> Option<PagedBlock> {
        self.blocks(None).into_iter().find(|b| b.block.id == block_id)
    }
}

// --- Editing -----------------------------------------------------------------

/// Block kinds the app knows (`BlockType` in `src/types.ts`).
pub const BLOCK_TYPES: &[&str] = &["query", "migration", "procedure", "trigger", "view", "script"];

/// Default size of a new SQL block, as in the app.
const DEFAULT_BLOCK_WIDTH: i64 = 520;
const DEFAULT_BLOCK_HEIGHT: i64 = 300;
/// Spacing of the staggered grid new blocks are placed on.
const BLOCK_GAP: i64 = 40;

/// A SQL block to add to a project.
#[derive(Clone, Debug)]
pub struct NewBlock {
    pub title: String,
    pub block_type: String,
    pub sql: String,
    /// Canvas position; defaults to the next slot of the app's staggered grid.
    pub position: Option<(f64, f64)>,
}

/// Fields of a SQL block that can be changed; `None` leaves a field as is.
#[derive(Clone, Debug, Default)]
pub struct BlockPatch {
    pub title: Option<String>,
    pub block_type: Option<String>,
    pub sql: Option<String>,
}

fn validate_block_type(block_type: &str) -> Result<(), String> {
    if BLOCK_TYPES.contains(&block_type) {
        Ok(())
    } else {
        Err(format!("unknown block type {block_type:?} (expected one of {BLOCK_TYPES:?})"))
    }
}

/// Port of the app's `staggeredPosition`: 4 blocks per row.
fn staggered_position(index: usize) -> Value {
    serde_json::json!({
        "x": 80 + (index % 4) as i64 * (DEFAULT_BLOCK_WIDTH + BLOCK_GAP),
        "y": 80 + (index / 4) as i64 * (DEFAULT_BLOCK_HEIGHT + BLOCK_GAP),
    })
}

/// A new node id, in the app's `block-<ms>-<seq>` format.
fn next_block_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    format!("block-{ms}-{}", SEQ.fetch_add(1, Ordering::Relaxed))
}

/// The nodes and edges of one page, borrowed for editing.
type PageParts<'a> = (&'a mut Vec<NotebookNode>, &'a mut Vec<Value>);

impl NotebookFile {
    /// True when the file stores its canvas as pages (v4+) rather than flat.
    fn is_paged(&self) -> bool {
        self.pages.as_ref().is_some_and(|p| !p.is_empty())
    }

    /// Every page's nodes and edges, for editing. A flat (v1–v3) file has a
    /// single implicit page and is kept flat — no format migration.
    fn all_parts_mut(&mut self) -> Vec<PageParts<'_>> {
        if self.is_paged() {
            self.pages
                .iter_mut()
                .flatten()
                .map(|p| (&mut p.nodes, &mut p.edges))
                .collect()
        } else {
            vec![(
                self.nodes.get_or_insert_with(Vec::new),
                self.edges.get_or_insert_with(Vec::new),
            )]
        }
    }

    /// The nodes of the page `page` (id or name), or of the first page.
    fn page_nodes_mut(&mut self, page: Option<&str>) -> Result<&mut Vec<NotebookNode>, String> {
        if !self.is_paged() {
            return match page {
                Some(q) if q != LEGACY_PAGE_ID && q != LEGACY_PAGE_NAME => {
                    Err(format!("no page {q:?} (this project has a single page)"))
                }
                _ => Ok(self.nodes.get_or_insert_with(Vec::new)),
            };
        }
        let pages = self.pages.as_mut().expect("paged");
        let found = match page {
            None => pages.first_mut(),
            Some(q) => pages.iter_mut().find(|p| p.id == q || p.name == q),
        };
        found
            .map(|p| &mut p.nodes)
            .ok_or_else(|| format!("no page {:?}", page.unwrap_or_default()))
    }
}

impl Project {
    /// Add a SQL block to `page` (id or name; default: the first page).
    pub fn create_block(&mut self, page: Option<&str>, block: NewBlock) -> Result<SqlBlock, String> {
        validate_block_type(&block.block_type)?;
        let nodes = self.file.page_nodes_mut(page)?;
        let position = match block.position {
            Some((x, y)) => serde_json::json!({ "x": x, "y": y }),
            None => staggered_position(nodes.len()),
        };
        let mut data = Map::new();
        data.insert("title".into(), block.title.into());
        data.insert("blockType".into(), block.block_type.into());
        data.insert("sql".into(), block.sql.into());
        data.insert("status".into(), "idle".into());
        data.insert("result".into(), Value::Null);
        data.insert("error".into(), Value::Null);
        data.insert("width".into(), DEFAULT_BLOCK_WIDTH.into());
        data.insert("height".into(), DEFAULT_BLOCK_HEIGHT.into());
        let node = NotebookNode {
            id: next_block_id(),
            kind: Some("sqlBlock".into()),
            position,
            parent_id: None,
            data,
            extra: Map::new(),
        };
        let created = node.sql_block().expect("a sqlBlock node");
        nodes.push(node);
        Ok(created)
    }

    /// Change the title, type and/or SQL of a SQL block. Every other field
    /// (size, result view, chart config…) is left untouched.
    pub fn update_block(&mut self, block_id: &str, patch: BlockPatch) -> Result<SqlBlock, String> {
        if let Some(t) = &patch.block_type {
            validate_block_type(t)?;
        }
        let node = self
            .file
            .all_parts_mut()
            .into_iter()
            .flat_map(|(nodes, _)| nodes.iter_mut())
            .find(|n| n.id == block_id && n.kind() == "sqlBlock")
            .ok_or_else(|| format!("no SQL block {block_id:?}"))?;
        for (key, value) in [("title", patch.title), ("blockType", patch.block_type), ("sql", patch.sql)] {
            if let Some(v) = value {
                node.data.insert(key.into(), v.into());
            }
        }
        Ok(node.sql_block().expect("a sqlBlock node"))
    }

    /// Delete a SQL or result block, like the app's `deleteBlock`: a SQL
    /// block takes its linked result block with it, a result block is unlinked
    /// from its source, and edges touching removed nodes go too. Groups are
    /// left to the app (deleting one re-parents its children).
    /// Returns the ids removed.
    pub fn delete_block(&mut self, block_id: &str) -> Result<Vec<String>, String> {
        for (nodes, edges) in self.file.all_parts_mut() {
            let Some(target) = nodes.iter().find(|n| n.id == block_id) else { continue };
            let kind = target.kind().to_string();
            let field = |key: &str| target.data.get(key).and_then(Value::as_str).map(str::to_owned);
            let (linked, source) = (field("linkedResultId"), field("sourceId"));

            let mut removed = vec![block_id.to_string()];
            match kind.as_str() {
                "sqlBlock" => removed.extend(linked),
                "resultBlock" => {
                    if let Some(src) = nodes.iter_mut().find(|n| Some(&n.id) == source.as_ref()) {
                        src.data.insert("linkedResultId".into(), Value::Null);
                    }
                }
                other => return Err(format!("{block_id:?} is a {other} node; delete it in the app")),
            }
            nodes.retain(|n| !removed.contains(&n.id));
            edges.retain(|e| {
                let touches = |k: &str| e.get(k).and_then(Value::as_str).is_some_and(|id| removed.iter().any(|r| r == id));
                !touches("source") && !touches("target")
            });
            return Ok(removed);
        }
        Err(format!("no block {block_id:?}"))
    }

    /// Write the project back to its `.graft` file (atomically), formatted
    /// like the app (2-space indented JSON).
    pub fn save(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&self.file).map_err(|e| e.to_string())?;
        save_project_file(&self.path, &json)
    }
}

/// Read and parse the `.graft` file at `path`.
pub fn load_project(path: &Path) -> Result<Project, String> {
    let json = load_project_file(path)?;
    Ok(Project {
        path: path.to_path_buf(),
        file: NotebookFile::parse(&json)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const V3_FLAT: &str = r##"{
      "version": 3, "name": "legacy", "dbType": "sqlite", "dbPath": "/tmp/x.db",
      "nodes": [
        { "id": "g1", "type": "group", "position": {"x":0,"y":0}, "data": {"title":"G","color":"#f00"} },
        { "id": "b1", "position": {"x":1,"y":2}, "parentId": "g1",
          "data": {"title":"Users","blockType":"query","sql":"SELECT * FROM users;"} }
      ],
      "edges": []
    }"##;

    const V5_PAGED: &str = r#"{
      "version": 5, "name": "shop", "dbType": "sqlite", "dbPath": "/tmp/shop.db",
      "dbSchema": [{"name":"users","kind":"table","columns":[{"name":"id","data_type":"INTEGER","notnull":false,"pk":true}],"foreign_keys":[]}],
      "snippets": [{"id":"s1","name":"recent","sql":"SELECT 1;","blockType":"query"}],
      "pages": [
        {"id":"p1","name":"Main","nodes":[
          {"id":"b1","type":"sqlBlock","position":{"x":0,"y":0},"data":{"title":"Q","blockType":"migration","sql":"SELECT {{recent}}","width":520}},
          {"id":"r1","type":"resultBlock","position":{"x":0,"y":0},"data":{"sourceId":"b1"}}
        ],"edges":[{"id":"e1","source":"b1","target":"r1"}]},
        {"id":"p2","name":"Other","nodes":[
          {"id":"b2","type":"sqlBlock","position":{"x":0,"y":0},"data":{"title":"Q2","blockType":"query","sql":"SELECT 2"}}
        ],"edges":[]}
      ],
      "futureField": {"kept": true}
    }"#;

    fn project(json: &str) -> Project {
        Project {
            path: "/tmp/p.graft".into(),
            file: NotebookFile::parse(json).unwrap(),
        }
    }

    #[test]
    fn reads_a_flat_pre_v4_file_as_one_page() {
        let p = project(V3_FLAT);
        let blocks = p.blocks(None);
        assert_eq!(blocks.len(), 1, "groups are not SQL blocks");
        assert_eq!(blocks[0].page_name, "Page 1");
        assert_eq!(blocks[0].block.sql, "SELECT * FROM users;");
        assert_eq!(blocks[0].block.group_id.as_deref(), Some("g1"));
    }

    #[test]
    fn reads_pages_schema_and_snippets_of_a_v5_file() {
        let p = project(V5_PAGED);
        assert_eq!(p.name(), "shop");
        assert_eq!(p.blocks(None).len(), 2, "result blocks are skipped");
        assert_eq!(p.blocks(Some("Other")).len(), 1);
        assert_eq!(p.blocks(Some("p1"))[0].block.block_type, "migration");
        assert_eq!(p.block("b2").unwrap().page_id, "p2");
        assert_eq!(p.file.snippets[0].name, "recent");
        assert!(p.file.db_schema.as_ref().unwrap()[0].columns[0].pk);
    }

    fn new_block(title: &str) -> NewBlock {
        NewBlock {
            title: title.into(),
            block_type: "query".into(),
            sql: "SELECT 1".into(),
            position: None,
        }
    }

    #[test]
    fn creates_blocks_shaped_like_the_app() {
        let mut p = project(V5_PAGED);
        let created = p.create_block(Some("Other"), new_block("New")).unwrap();
        assert!(created.id.starts_with("block-"));
        let out = serde_json::to_value(&p.file).unwrap();
        let node = &out["pages"][1]["nodes"][1];
        assert_eq!(node["type"], "sqlBlock");
        assert_eq!(node["data"]["status"], "idle");
        assert_eq!(node["data"]["width"], 520);
        // Second node on the page → second slot of the staggered grid.
        assert_eq!(node["position"]["x"], 80 + 560);
        assert_eq!(p.blocks(Some("p2")).len(), 2);

        assert!(p.create_block(Some("nope"), new_block("x")).is_err());
        let mut bad = new_block("x");
        bad.block_type = "table".into();
        assert!(p.create_block(None, bad).is_err());
    }

    #[test]
    fn edits_a_flat_file_without_migrating_it() {
        let mut p = project(V3_FLAT);
        let created = p.create_block(None, new_block("Flat")).unwrap();
        assert_eq!(p.blocks(None).len(), 2);
        let out = serde_json::to_value(&p.file).unwrap();
        assert!(out.get("pages").is_none(), "stays a flat v3 file");
        assert_eq!(out["version"], 3);
        assert!(p.create_block(Some("Other"), new_block("x")).is_err());
        assert_eq!(p.delete_block(&created.id).unwrap(), vec![created.id]);
    }

    #[test]
    fn updates_only_the_patched_fields() {
        let mut p = project(V5_PAGED);
        let patch = BlockPatch { sql: Some("SELECT 42".into()), ..Default::default() };
        let updated = p.update_block("b1", patch).unwrap();
        assert_eq!(updated.sql, "SELECT 42");
        assert_eq!(updated.title, "Q");
        let out = serde_json::to_value(&p.file).unwrap();
        assert_eq!(out["pages"][0]["nodes"][0]["data"]["width"], 520);
        assert!(p.update_block("r1", BlockPatch::default()).is_err(), "result blocks have no SQL");
        assert!(p.update_block("missing", BlockPatch::default()).is_err());
    }

    #[test]
    fn deletes_with_the_apps_cascade() {
        let linked = V5_PAGED.replace(r#""width":520"#, r#""width":520,"linkedResultId":"r1""#);
        let mut p = project(&linked);
        assert_eq!(p.delete_block("b1").unwrap(), vec!["b1", "r1"]);
        let out = serde_json::to_value(&p.file).unwrap();
        assert_eq!(out["pages"][0]["nodes"].as_array().unwrap().len(), 0);
        assert_eq!(out["pages"][0]["edges"].as_array().unwrap().len(), 0);

        let mut p = project(&linked);
        assert_eq!(p.delete_block("r1").unwrap(), vec!["r1"]);
        assert_eq!(p.block("b1").unwrap().block.id, "b1");
        let out = serde_json::to_value(&p.file).unwrap();
        assert_eq!(out["pages"][0]["nodes"][0]["data"]["linkedResultId"], Value::Null);
    }

    #[test]
    fn saves_atomically_and_keeps_key_order() {
        let dir = std::env::temp_dir().join(format!("graft-nbsave-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("p.graft");
        let mut p = project(V5_PAGED);
        p.path = path.clone();
        p.update_block("b2", BlockPatch { title: Some("Renamed".into()), ..Default::default() })
            .unwrap();
        p.save().unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let first_keys: Vec<&str> = text.lines().skip(1).take(3).map(str::trim).collect();
        assert!(first_keys[0].starts_with("\"version\""));
        assert!(first_keys[1].starts_with("\"name\""));
        assert_eq!(load_project(&path).unwrap().block("b2").unwrap().block.title, "Renamed");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn round_trips_without_losing_unknown_fields() {
        let p = project(V5_PAGED);
        let out = serde_json::to_value(&p.file).unwrap();
        assert_eq!(out["futureField"]["kept"], true);
        assert_eq!(out["pages"][0]["nodes"][0]["data"]["width"], 520);
        assert_eq!(out["pages"][0]["nodes"][0]["position"]["x"], 0);
        assert_eq!(out["pages"][0]["edges"][0]["target"], "r1");
    }
}
