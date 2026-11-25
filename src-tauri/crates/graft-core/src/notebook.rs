//! The `.graft` project file, read and edited from Rust (the MCP server).
//!
//! The frontend owns the format (`src/types.ts` › `NotebookFile`); this
//! module works on the JSON tree directly so every field it does not know
//! about — result views, chart configs, groups, future additions — survives a
//! round trip untouched. It understands just enough to list, read, create and
//! update SQL blocks, resolve the connection and expand `{{favorite}}`
//! references exactly like the app's `runBlock`.

use std::time::{SystemTime, UNIX_EPOCH};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::db::schema::TableInfo;
use crate::db::{ConnectionConfig, Engine};

/// Block kinds the app knows (`BlockType` in `src/types.ts`).
pub const BLOCK_TYPES: [&str; 6] = ["query", "migration", "procedure", "trigger", "view", "script"];

/// Same defaults as the app's new blocks (`DEFAULT_BLOCK_WIDTH/HEIGHT`).
const DEFAULT_BLOCK_WIDTH: f64 = 520.0;
const DEFAULT_BLOCK_HEIGHT: f64 = 300.0;
const DEFAULT_BLOCK_X: f64 = 80.0;
const BLOCK_GAP: f64 = 40.0;
/// Guard against pathological `{{a}}` → `{{b}}` → … chains (as in the app).
const MAX_SNIPPET_DEPTH: usize = 10;
/// Id given to the SQLite connection of files written before v6 (as in the app).
const LEGACY_SQLITE_ID: &str = "sqlite-legacy";

static BLOCK_SEQ: AtomicU64 = AtomicU64::new(0);

/// A SQL block as exposed to MCP clients.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Block {
    pub id: String,
    /// Page the block is on (None for single-canvas files written before v4).
    pub page_id: Option<String>,
    pub page_name: String,
    pub title: String,
    pub block_type: String,
    pub sql: String,
    pub x: f64,
    pub y: f64,
}

/// A saved favorite, referenced as `{{name}}` in other blocks.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Snippet {
    pub name: String,
    pub sql: String,
}

#[derive(Default)]
pub struct NewBlock {
    pub title: Option<String>,
    pub block_type: Option<String>,
    pub sql: String,
    pub page_id: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

#[derive(Default)]
pub struct BlockPatch {
    pub title: Option<String>,
    pub block_type: Option<String>,
    pub sql: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

pub struct Notebook {
    root: Map<String, Value>,
}

fn string_at<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn number_at(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn validate_block_type(block_type: &str) -> Result<(), String> {
    if BLOCK_TYPES.contains(&block_type) {
        Ok(())
    } else {
        Err(format!("unknown block type {block_type:?} (expected one of {})", BLOCK_TYPES.join(", ")))
    }
}

fn new_block_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    format!("block-mcp-{millis}-{}", BLOCK_SEQ.fetch_add(1, Ordering::Relaxed))
}

impl Notebook {
    pub fn parse(json: &str) -> Result<Self, String> {
        match serde_json::from_str::<Value>(json) {
            Ok(Value::Object(root)) => Ok(Notebook { root }),
            Ok(_) => Err("not a Graft project: the file is not a JSON object".into()),
            Err(e) => Err(format!("not a Graft project: {e}")),
        }
    }

    /// Pretty JSON, indented like the app writes it (`JSON.stringify(…, null, 2)`).
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(&self.root).unwrap_or_default()
    }

    pub fn name(&self) -> String {
        self.root.get("name").and_then(Value::as_str).unwrap_or("untitled").to_string()
    }

    /// The connection: v6 `connection`, or the legacy SQLite `dbPath`.
    pub fn connection(&self) -> Option<ConnectionConfig> {
        if let Some(connection) = self.root.get("connection") {
            return serde_json::from_value(connection.clone()).ok();
        }
        let is_sqlite = self.root.get("dbType").and_then(Value::as_str).unwrap_or("sqlite") == "sqlite";
        let path = self.root.get("dbPath").and_then(Value::as_str)?;
        is_sqlite.then(|| ConnectionConfig {
            id: LEGACY_SQLITE_ID.into(),
            engine: Engine::Sqlite,
            path: Some(path.to_string()),
            host: None,
            port: None,
            database: None,
            user: None,
            ssl_mode: Default::default(),
        })
    }

    /// Structure cached by the app at its last introspection.
    pub fn cached_tables(&self) -> Vec<TableInfo> {
        self.root
            .get("dbSchema")
            .and_then(|schema| serde_json::from_value(schema.clone()).ok())
            .unwrap_or_default()
    }

    pub fn snippets(&self) -> Vec<Snippet> {
        let Some(list) = self.root.get("snippets").and_then(Value::as_array) else {
            return Vec::new();
        };
        list.iter()
            .filter_map(|s| {
                Some(Snippet { name: string_at(s, "name")?.to_string(), sql: string_at(s, "sql")?.to_string() })
            })
            .collect()
    }

    /// (page id, page name, nodes) for each page; files older than v4 have a
    /// single implicit page with top-level `nodes`.
    fn pages(&self) -> Vec<(Option<String>, String, &Vec<Value>)> {
        if let Some(pages) = self.root.get("pages").and_then(Value::as_array) {
            if !pages.is_empty() {
                return pages
                    .iter()
                    .filter_map(|page| {
                        let nodes = page.get("nodes")?.as_array()?;
                        let id = string_at(page, "id").map(str::to_string);
                        let name = string_at(page, "name").unwrap_or("Page").to_string();
                        Some((id, name, nodes))
                    })
                    .collect();
            }
        }
        match self.root.get("nodes").and_then(Value::as_array) {
            Some(nodes) => vec![(None, "Page 1".to_string(), nodes)],
            None => Vec::new(),
        }
    }

    fn nodes_mut(&mut self, page_id: Option<&str>) -> Result<&mut Vec<Value>, String> {
        let has_pages = self.root.get("pages").and_then(Value::as_array).is_some_and(|p| !p.is_empty());
        if !has_pages {
            if page_id.is_some() {
                return Err("this project has a single canvas: omit the page".into());
            }
            let nodes = self.root.entry("nodes").or_insert_with(|| json!([]));
            return nodes.as_array_mut().ok_or_else(|| "malformed project: nodes is not a list".into());
        }
        let pages = self.root.get_mut("pages").and_then(Value::as_array_mut).expect("checked above");
        let page = match page_id {
            Some(id) => pages
                .iter_mut()
                .find(|p| string_at(p, "id") == Some(id))
                .ok_or_else(|| format!("no page with id {id:?}"))?,
            None => pages.first_mut().expect("checked non-empty"),
        };
        let nodes = page.as_object_mut().ok_or("malformed page")?.entry("nodes").or_insert_with(|| json!([]));
        nodes.as_array_mut().ok_or_else(|| "malformed project: nodes is not a list".into())
    }

    fn block_from(node: &Value, page_id: &Option<String>, page_name: &str) -> Option<Block> {
        // Files before v2 had no `type`: every node was a SQL block.
        if string_at(node, "type").unwrap_or("sqlBlock") != "sqlBlock" {
            return None;
        }
        let data = node.get("data")?;
        let position = node.get("position");
        Some(Block {
            id: string_at(node, "id")?.to_string(),
            page_id: page_id.clone(),
            page_name: page_name.to_string(),
            title: string_at(data, "title").unwrap_or("").to_string(),
            block_type: string_at(data, "blockType").unwrap_or("query").to_string(),
            sql: string_at(data, "sql").unwrap_or("").to_string(),
            x: position.and_then(|p| number_at(p, "x")).unwrap_or_default(),
            y: position.and_then(|p| number_at(p, "y")).unwrap_or_default(),
        })
    }

    pub fn blocks(&self) -> Vec<Block> {
        self.pages()
            .into_iter()
            .flat_map(|(page_id, page_name, nodes)| {
                nodes.iter().filter_map(move |node| Self::block_from(node, &page_id, &page_name))
            })
            .collect()
    }

    pub fn block(&self, id: &str) -> Option<Block> {
        self.blocks().into_iter().find(|b| b.id == id)
    }

    /// Spot under the lowest node of the page, so a new block never covers one.
    fn free_position(nodes: &[Value]) -> (f64, f64) {
        let bottom = nodes
            .iter()
            .filter(|n| n.get("parentId").is_none())
            .filter_map(|n| {
                let y = n.get("position").and_then(|p| number_at(p, "y"))?;
                let height = n.get("data").and_then(|d| number_at(d, "height")).unwrap_or(DEFAULT_BLOCK_HEIGHT);
                Some(y + height)
            })
            .fold(None, |max: Option<f64>, b| Some(max.map_or(b, |m| m.max(b))));
        (DEFAULT_BLOCK_X, bottom.map_or(DEFAULT_BLOCK_X, |b| b + BLOCK_GAP))
    }

    /// Add a SQL block (shaped like the app's new blocks) and return it.
    pub fn create_block(&mut self, new: NewBlock) -> Result<Block, String> {
        let block_type = new.block_type.unwrap_or_else(|| "query".into());
        validate_block_type(&block_type)?;
        let nodes = self.nodes_mut(new.page_id.as_deref())?;
        let title = new.title.unwrap_or_else(|| {
            let count = nodes.iter().filter(|n| string_at(n, "type").unwrap_or("sqlBlock") == "sqlBlock").count();
            format!("{}{} {}", block_type[..1].to_uppercase(), &block_type[1..], count + 1)
        });
        let (free_x, free_y) = Self::free_position(nodes);
        let id = new_block_id();
        nodes.push(json!({
            "id": id,
            "type": "sqlBlock",
            "position": { "x": new.x.unwrap_or(free_x), "y": new.y.unwrap_or(free_y) },
            "data": {
                "title": title,
                "blockType": block_type,
                "sql": new.sql,
                "status": "idle",
                "result": null,
                "error": null,
                "width": DEFAULT_BLOCK_WIDTH,
                "height": DEFAULT_BLOCK_HEIGHT,
            },
        }));
        self.block(&id).ok_or_else(|| "block was not created".into())
    }

    /// Change a block's SQL, title, type or position.
    pub fn update_block(&mut self, id: &str, patch: BlockPatch) -> Result<Block, String> {
        if let Some(block_type) = &patch.block_type {
            validate_block_type(block_type)?;
        }
        let page_id = self.block(id).ok_or_else(|| format!("no block with id {id:?}"))?.page_id;
        let nodes = self.nodes_mut(page_id.as_deref())?;
        let node = nodes
            .iter_mut()
            .find(|n| string_at(n, "id") == Some(id))
            .ok_or_else(|| format!("no block with id {id:?}"))?;
        if let Some(position) = node.get_mut("position").and_then(Value::as_object_mut) {
            if let Some(x) = patch.x {
                position.insert("x".into(), json!(x));
            }
            if let Some(y) = patch.y {
                position.insert("y".into(), json!(y));
            }
        }
        let data = node.get_mut("data").and_then(Value::as_object_mut).ok_or("malformed block")?;
        for (key, value) in [("title", patch.title), ("blockType", patch.block_type), ("sql", patch.sql)] {
            if let Some(value) = value {
                data.insert(key.into(), Value::String(value));
            }
        }
        self.block(id).ok_or_else(|| "block disappeared".into())
    }
}

fn is_snippet_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-')
}

/// Parse a `{{ name }}` reference at the start of `text`: (name, length).
fn snippet_reference(text: &str) -> Option<(&str, usize)> {
    let inner = text.strip_prefix("{{")?;
    let trimmed = inner.trim_start();
    let name_len = trimmed.find(|c: char| !is_snippet_name_char(c)).unwrap_or(trimmed.len());
    if name_len == 0 {
        return None;
    }
    let after = trimmed[name_len..].trim_start();
    after.strip_prefix("}}")?;
    let consumed = text.len() - after.len() + "}}".len();
    Some((&trimmed[..name_len], consumed))
}

fn expand(sql: &str, snippets: &[Snippet], seen: &mut Vec<String>, depth: usize) -> String {
    if depth > MAX_SNIPPET_DEPTH {
        return sql.to_string();
    }
    let mut out = String::with_capacity(sql.len());
    let mut rest = sql;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let candidate = &rest[start..];
        match snippet_reference(candidate) {
            Some((name, consumed)) => {
                let snippet = snippets.iter().find(|s| s.name == name);
                match snippet.filter(|_| !seen.iter().any(|s| s == name)) {
                    Some(snippet) => {
                        let body = snippet.sql.trim();
                        let body = body.strip_suffix(';').map_or(body, str::trim_end);
                        seen.push(name.to_string());
                        let inner = expand(body, snippets, seen, depth + 1);
                        seen.pop();
                        out.push('(');
                        out.push_str(&inner);
                        out.push(')');
                    }
                    // Unknown or cyclic: left as written, the database reports it.
                    None => out.push_str(&candidate[..consumed]),
                }
                rest = &candidate[consumed..];
            }
            None => {
                out.push_str("{{");
                rest = &candidate[2..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Replace `{{name}}` references with the favorite's SQL in parentheses, as
/// the app does before running a block (`expandSnippets` in snippets.ts).
pub fn expand_snippets(sql: &str, snippets: &[Snippet]) -> String {
    expand(sql, snippets, &mut Vec::new(), 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const V6: &str = r##"{
      "version": 6, "name": "shop", "dbType": "postgres", "dbPath": null,
      "connection": {"id": "c1", "engine": "postgres", "host": "db", "user": "ada"},
      "snippets": [{"id": "s", "name": "recent", "sql": "SELECT * FROM users;", "blockType": "query"}],
      "pages": [
        {"id": "p1", "name": "Main", "nodes": [
          {"id": "b1", "type": "sqlBlock", "position": {"x": 80, "y": 80},
           "data": {"title": "Q", "blockType": "query", "sql": "SELECT 1", "resultView": "chart", "height": 300}},
          {"id": "g1", "type": "group", "position": {"x": 0, "y": 0}, "data": {"title": "G", "color": "#fff"}}
        ], "edges": []},
        {"id": "p2", "name": "Other", "nodes": [], "edges": []}
      ],
      "futureField": {"kept": true}
    }"##;

    fn snippet(name: &str, sql: &str) -> Snippet {
        Snippet { name: name.into(), sql: sql.into() }
    }

    #[test]
    fn reads_blocks_connection_and_snippets() {
        let notebook = Notebook::parse(V6).unwrap();
        assert_eq!(notebook.name(), "shop");
        assert_eq!(notebook.connection().unwrap().engine, Engine::Postgres);
        assert_eq!(notebook.snippets(), vec![snippet("recent", "SELECT * FROM users;")]);
        let blocks = notebook.blocks();
        assert_eq!(blocks.len(), 1, "groups are not blocks");
        assert_eq!(blocks[0].page_name, "Main");
        assert_eq!(blocks[0].sql, "SELECT 1");
    }

    #[test]
    fn creates_and_updates_blocks_keeping_unknown_fields() {
        let mut notebook = Notebook::parse(V6).unwrap();
        let created = notebook
            .create_block(NewBlock { sql: "SELECT 2".into(), page_id: Some("p1".into()), ..Default::default() })
            .unwrap();
        assert_eq!(created.title, "Query 2");
        assert_eq!((created.x, created.y), (80.0, 420.0), "placed under the existing block");

        let updated = notebook
            .update_block(&created.id, BlockPatch { sql: Some("SELECT 3".into()), block_type: Some("script".into()), ..Default::default() })
            .unwrap();
        assert_eq!((updated.sql.as_str(), updated.block_type.as_str()), ("SELECT 3", "script"));
        assert!(notebook.update_block(&created.id, BlockPatch { block_type: Some("nope".into()), ..Default::default() }).is_err());
        assert!(notebook.create_block(NewBlock { page_id: Some("missing".into()), ..Default::default() }).is_err());

        let saved: Value = serde_json::from_str(&notebook.to_json()).unwrap();
        assert_eq!(saved["futureField"]["kept"], json!(true));
        assert_eq!(saved["pages"][0]["nodes"][0]["data"]["resultView"], json!("chart"));
        assert_eq!(saved["pages"][0]["nodes"][2]["data"]["status"], json!("idle"));
    }

    #[test]
    fn reads_legacy_single_canvas_files() {
        let legacy = r#"{"version": 1, "name": "old", "dbType": "sqlite", "dbPath": "/a.db",
                         "nodes": [{"id": "b", "position": {"x": 0, "y": 0}, "data": {"title": "T", "blockType": "query", "sql": "SELECT 1"}}]}"#;
        let mut notebook = Notebook::parse(legacy).unwrap();
        assert_eq!(notebook.connection().unwrap().path.as_deref(), Some("/a.db"));
        assert_eq!(notebook.blocks()[0].page_id, None);
        notebook.create_block(NewBlock { sql: "SELECT 2".into(), ..Default::default() }).unwrap();
        assert_eq!(notebook.blocks().len(), 2);
        assert!(Notebook::parse("[1]").is_err());
    }

    #[test]
    fn expands_snippets_like_the_app() {
        let snippets = vec![snippet("recent", "SELECT * FROM users;")];
        assert_eq!(expand_snippets("SELECT * FROM {{ recent }} r", &snippets), "SELECT * FROM (SELECT * FROM users) r");
        let nested = vec![snippet("a", "SELECT * FROM {{b}}"), snippet("b", "SELECT 1"), snippet("c", "{{c}}")];
        assert_eq!(expand_snippets("{{a}}", &nested), "(SELECT * FROM (SELECT 1))");
        assert_eq!(expand_snippets("{{nope}}", &nested), "{{nope}}");
        assert_eq!(expand_snippets("{{c}}", &nested), "({{c}})");
        assert_eq!(expand_snippets("SELECT '{{' || x", &nested), "SELECT '{{' || x");
    }
}
