//! Typed, read-side model of a `.graft` project file.
//!
//! Mirrors `NotebookFile` in `src/types.ts`. The app (TypeScript) remains the
//! writer of the format; this module lets Rust consumers (the MCP server) read
//! any version (v1–v5) without losing data: every struct keeps the fields it
//! does not model in an `extra` map, so a load → save round trip is lossless.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::db::TableInfo;
use crate::files::load_project_file;

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
