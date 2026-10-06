//! MCP tools and resources over Graft projects.
//!
//! Databases are read-only by construction: every one is opened with
//! `OpenOptions { read_only: true }`, so a write statement fails in SQLite
//! itself rather than relying on SQL parsing. The block tools (create / update
//! / delete) write the `.graft` file only — never the database — and can be
//! turned off with `--read-only`. An open Graft app reloads the file.

use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::{Mutex, MutexGuard};

use graft_core::db::{self, OpenOptions};
use graft_core::notebook::{BlockPatch, NewBlock, Project, BLOCK_TYPES};
use graft_core::snippets::expand_snippets;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    Implementation, ListResourcesResult, PaginatedRequestParams, ReadResourceRequestParams,
    ReadResourceResponse, ReadResourceResult, Resource, ResourceContents, ServerCapabilities,
    ServerConfig,
};
use rmcp::schemars::{self, JsonSchema};
use rmcp::service::RequestContext;
use rmcp::{tool, tool_handler, tool_router, ErrorData, RoleServer, ServerHandler};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::projects::Roots;

/// Rows returned when the caller does not ask for a number: enough to see the
/// shape of a result without flooding the model's context.
const DEFAULT_MAX_ROWS: usize = 200;

const INSTRUCTIONS: &str = "Access to Graft projects (SQL notebooks laid out on a canvas). \
Start with list_projects, then get_schema / list_blocks. run_query, run_block and explain_query execute SQL \
read-only (writes are rejected by the database) and expand {{favorite}} references like the app does. \
create_block / update_block / delete_block edit the project's .graft file (never the database); an open \
Graft app reloads it. To change data or schema, write the SQL into a block for the user to review and run. \
Only SQLite projects can be queried for now.";

/// Error returned by the block tools when the server runs with `--read-only`.
const READ_ONLY_ERROR: &str =
    "this graft-mcp server runs with --read-only: block editing is disabled";

#[derive(Deserialize, JsonSchema)]
pub struct ProjectArgs {
    /// Project name (as shown by list_projects) or path of its .graft file.
    pub project: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct ListBlocksArgs {
    /// Project name or .graft path.
    pub project: String,
    /// Only list blocks of this page (page id or name).
    pub page: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct BlockArgs {
    /// Project name or .graft path.
    pub project: String,
    /// Block id (from list_blocks).
    pub block_id: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct RunQueryArgs {
    /// Project name or .graft path.
    pub project: String,
    /// SQL to run read-only. `{{name}}` favorites are expanded.
    pub sql: String,
    /// Maximum rows to return (default 200, capped at 5000).
    pub max_rows: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
pub struct RunBlockArgs {
    /// Project name or .graft path.
    pub project: String,
    /// Block id (from list_blocks).
    pub block_id: String,
    /// Maximum rows to return (default 200, capped at 5000).
    pub max_rows: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
pub struct ExplainArgs {
    /// Project name or .graft path.
    pub project: String,
    /// SQL to explain (EXPLAIN QUERY PLAN). `{{name}}` favorites are expanded.
    pub sql: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct CreateBlockArgs {
    /// Project name or .graft path.
    pub project: String,
    /// Block title shown on the canvas.
    pub title: String,
    /// SQL of the block. May reference `{{favorite}}` blocks.
    pub sql: String,
    /// One of query, migration, procedure, trigger, view, script (default: query).
    pub block_type: Option<String>,
    /// Page id or name (default: the first page).
    pub page: Option<String>,
    /// Canvas x position (default: next free slot of the grid). Give x and y together.
    pub x: Option<f64>,
    /// Canvas y position.
    pub y: Option<f64>,
}

#[derive(Deserialize, JsonSchema)]
pub struct UpdateBlockArgs {
    /// Project name or .graft path.
    pub project: String,
    /// Block id (from list_blocks).
    pub block_id: String,
    /// New title (unchanged if omitted).
    pub title: Option<String>,
    /// New SQL (unchanged if omitted).
    pub sql: Option<String>,
    /// New block type (unchanged if omitted).
    pub block_type: Option<String>,
}

#[derive(Clone)]
pub struct GraftServer {
    roots: Roots,
    /// When true, the block tools refuse to write `.graft` files.
    read_only: bool,
    /// Serializes block edits: tool calls run concurrently, and two
    /// read-modify-write cycles on one file would otherwise lose an edit.
    edit_lock: Arc<Mutex<()>>,
    tool_router: ToolRouter<Self>,
}

fn to_json(value: &impl serde::Serialize) -> Result<String, String> {
    serde_json::to_string_pretty(value).map_err(|e| e.to_string())
}

/// The database file of a SQLite project. A relative `dbPath` is resolved
/// against the project file's directory.
fn sqlite_path(project: &Project) -> Result<String, String> {
    if project.file.db_type != "sqlite" {
        return Err(format!(
            "project {:?} uses {}; only SQLite can be queried for now (Postgres/MySQL: v0.3)",
            project.name(),
            project.file.db_type
        ));
    }
    let raw = project
        .file
        .db_path
        .as_deref()
        .filter(|p| !p.is_empty())
        .ok_or_else(|| format!("project {:?} has no database attached", project.name()))?;
    let path = PathBuf::from(raw);
    let path = if path.is_relative() {
        project.path.parent().map_or(path.clone(), |dir| dir.join(&path))
    } else {
        path
    };
    Ok(path.to_string_lossy().into_owned())
}

/// Resource URI segment for a project: its name, percent-encoding the few
/// characters that would break a URI.
fn uri_segment(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            ' ' => "%20".to_string(),
            '/' => "%2F".to_string(),
            '#' => "%23".to_string(),
            '?' => "%3F".to_string(),
            '%' => "%25".to_string(),
            c => c.to_string(),
        })
        .collect()
}

impl GraftServer {
    pub fn new(roots: Roots, read_only: bool) -> Self {
        Self {
            roots,
            read_only,
            edit_lock: Arc::new(Mutex::new(())),
            tool_router: Self::tool_router(),
        }
    }

    /// Resolve a project for editing: refused in `--read-only` mode. The
    /// returned guard must be held until the project is saved.
    async fn editable(&self, project: &str) -> Result<(MutexGuard<'_, ()>, Project), String> {
        if self.read_only {
            return Err(READ_ONLY_ERROR.into());
        }
        let guard = self.edit_lock.lock().await;
        Ok((guard, self.roots.resolve(project)?))
    }

    async fn run_sql(&self, project: &Project, sql: &str, max_rows: Option<usize>) -> Result<String, String> {
        let db_path = sqlite_path(project)?;
        let expanded = expand_snippets(sql, &project.file.snippets);
        let max = max_rows.unwrap_or(DEFAULT_MAX_ROWS).clamp(1, db::DEFAULT_MAX_ROWS);
        let result = db::execute_sql(&db_path, &expanded, Some(max), OpenOptions { read_only: true }).await?;
        let mut out = serde_json::to_value(&result).map_err(|e| e.to_string())?;
        if expanded != sql {
            out["expanded_sql"] = Value::String(expanded);
        }
        to_json(&out)
    }

    async fn schema_of(&self, project: &Project) -> Result<String, String> {
        let live = match sqlite_path(project) {
            Ok(path) => db::introspect_schema(&path, OpenOptions { read_only: true }).await,
            Err(e) => Err(e),
        };
        match (live, &project.file.db_schema) {
            (Ok(tables), _) => to_json(&json!({ "source": "live", "tables": tables })),
            (Err(e), Some(cached)) => to_json(&json!({
                "source": "cached in the .graft file (live introspection failed)",
                "error": e,
                "tables": cached,
            })),
            (Err(e), None) => Err(e),
        }
    }

    /// Every resource this server exposes, recomputed from disk.
    fn resources(&self) -> Vec<(Resource, String, Option<String>)> {
        let mut out = Vec::new();
        for project in self.roots.projects() {
            let name = project.name();
            let path = project.path.to_string_lossy().into_owned();
            let base = format!("graft://{}", uri_segment(&name));
            out.push((
                Resource::new(format!("{base}/schema"), format!("{name} — schema"))
                    .with_description("Tables, columns and foreign keys of the project database"),
                path.clone(),
                None,
            ));
            for b in project.blocks(None) {
                out.push((
                    Resource::new(
                        format!("{base}/blocks/{}", uri_segment(&b.block.id)),
                        format!("{name} — {}", b.block.title),
                    )
                    .with_description(format!("SQL of the {} block on page {}", b.block.block_type, b.page_name)),
                    path.clone(),
                    Some(b.block.id.clone()),
                ));
            }
        }
        out
    }
}

#[tool_router]
impl GraftServer {
    #[tool(description = "List the Graft projects (.graft files) this server can read: name, path, database engine and database path.")]
    async fn list_projects(&self) -> Result<String, String> {
        let projects: Vec<Value> = self
            .roots
            .projects()
            .iter()
            .map(|p| {
                json!({
                    "name": p.name(),
                    "path": p.path,
                    "dbType": p.file.db_type,
                    "dbPath": p.file.db_path,
                    "blocks": p.blocks(None).len(),
                })
            })
            .collect();
        to_json(&json!({ "roots": self.roots.dirs(), "projects": projects }))
    }

    #[tool(description = "Database schema of a project: tables/views with columns (type, notnull, pk) and foreign keys. Introspected live; falls back to the schema cached in the .graft file.")]
    async fn get_schema(&self, Parameters(args): Parameters<ProjectArgs>) -> Result<String, String> {
        let project = self.roots.resolve(&args.project)?;
        self.schema_of(&project).await
    }

    #[tool(description = "List the SQL blocks of a project (id, title, block type, page, group). Optionally filter by page.")]
    async fn list_blocks(&self, Parameters(args): Parameters<ListBlocksArgs>) -> Result<String, String> {
        let project = self.roots.resolve(&args.project)?;
        let blocks: Vec<Value> = project
            .blocks(args.page.as_deref())
            .into_iter()
            .map(|b| {
                json!({
                    "id": b.block.id,
                    "title": b.block.title,
                    "blockType": b.block.block_type,
                    "pageId": b.page_id,
                    "pageName": b.page_name,
                    "groupId": b.block.group_id,
                })
            })
            .collect();
        to_json(&blocks)
    }

    #[tool(description = "Read one SQL block of a project: its SQL and metadata.")]
    async fn read_block(&self, Parameters(args): Parameters<BlockArgs>) -> Result<String, String> {
        let project = self.roots.resolve(&args.project)?;
        let block = project
            .block(&args.block_id)
            .ok_or_else(|| format!("no SQL block {:?} in project {:?}", args.block_id, project.name()))?;
        to_json(&block)
    }

    #[tool(description = "Run SQL read-only against a project's database (writes are rejected). {{favorite}} references are expanded first. Returns columns, rows (capped), total_rows and truncated.")]
    async fn run_query(&self, Parameters(args): Parameters<RunQueryArgs>) -> Result<String, String> {
        let project = self.roots.resolve(&args.project)?;
        self.run_sql(&project, &args.sql, args.max_rows).await
    }

    #[tool(description = "Run the SQL of one block read-only (writes are rejected), with {{favorite}} references expanded.")]
    async fn run_block(&self, Parameters(args): Parameters<RunBlockArgs>) -> Result<String, String> {
        let project = self.roots.resolve(&args.project)?;
        let block = project
            .block(&args.block_id)
            .ok_or_else(|| format!("no SQL block {:?} in project {:?}", args.block_id, project.name()))?;
        self.run_sql(&project, &block.block.sql, args.max_rows).await
    }

    #[tool(description = "Show SQLite's query plan (EXPLAIN QUERY PLAN) for a statement, read-only, with {{favorite}} references expanded. Use it to check index usage before suggesting a query or migration.")]
    async fn explain_query(&self, Parameters(args): Parameters<ExplainArgs>) -> Result<String, String> {
        let project = self.roots.resolve(&args.project)?;
        let sql = args.sql.trim().trim_end_matches(';');
        self.run_sql(&project, &format!("EXPLAIN QUERY PLAN {sql}"), None).await
    }

    #[tool(description = "Add a SQL block to a project's canvas (writes the .graft file, not the database). Returns the new block with its id. Prefer this to running writes: the user reviews and runs the block.")]
    async fn create_block(&self, Parameters(args): Parameters<CreateBlockArgs>) -> Result<String, String> {
        let (_guard, mut project) = self.editable(&args.project).await?;
        let position = match (args.x, args.y) {
            (Some(x), Some(y)) => Some((x, y)),
            (None, None) => None,
            _ => return Err("give both x and y, or neither".into()),
        };
        let block = NewBlock {
            title: args.title,
            block_type: args.block_type.unwrap_or_else(|| BLOCK_TYPES[0].into()),
            sql: args.sql,
            position,
        };
        let created = project.create_block(args.page.as_deref(), block)?;
        project.save()?;
        to_json(&created)
    }

    #[tool(description = "Change the title, SQL and/or block type of a SQL block (writes the .graft file). Omitted fields are left unchanged.")]
    async fn update_block(&self, Parameters(args): Parameters<UpdateBlockArgs>) -> Result<String, String> {
        let (_guard, mut project) = self.editable(&args.project).await?;
        let patch = BlockPatch {
            title: args.title,
            block_type: args.block_type,
            sql: args.sql,
        };
        let updated = project.update_block(&args.block_id, patch)?;
        project.save()?;
        to_json(&updated)
    }

    #[tool(description = "Delete a block from a project's canvas (writes the .graft file). A SQL block's linked result block is deleted with it. Returns the removed ids.")]
    async fn delete_block(&self, Parameters(args): Parameters<BlockArgs>) -> Result<String, String> {
        let (_guard, mut project) = self.editable(&args.project).await?;
        let removed = project.delete_block(&args.block_id)?;
        project.save()?;
        to_json(&json!({ "removed": removed }))
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for GraftServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().enable_resources().build())
            .with_server_info(Implementation::new("graft", env!("CARGO_PKG_VERSION")))
            .with_instructions(INSTRUCTIONS)
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        Ok(ListResourcesResult::with_all_items(
            self.resources().into_iter().map(|(r, _, _)| r).collect(),
        ))
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, ErrorData> {
        let (_, path, block_id) = self
            .resources()
            .into_iter()
            .find(|(r, _, _)| r.uri == request.uri)
            .ok_or_else(|| ErrorData::resource_not_found(format!("unknown resource {}", request.uri), None))?;
        let project = self
            .roots
            .resolve(&path)
            .map_err(|e| ErrorData::internal_error(e, None))?;
        let text = match block_id {
            None => self.schema_of(&project).await,
            Some(id) => project
                .block(&id)
                .map(|b| b.block.sql)
                .ok_or_else(|| format!("block {id} disappeared")),
        }
        .map_err(|e| ErrorData::internal_error(e, None))?;
        Ok(ReadResourceResult::new(vec![ResourceContents::text(text, request.uri)]).into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A project "shop" (3 users, one block using a favorite) in its own
    /// directory — `tag` keeps parallel tests apart.
    async fn fixture(tag: &str, read_only: bool) -> (PathBuf, GraftServer) {
        let root = std::env::temp_dir().join(format!("graft-mcp-srv-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let db_path = root.join("shop.db");
        let db_str = db_path.to_string_lossy().into_owned();
        db::execute_sql(&db_str, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)", None, OpenOptions::default())
            .await
            .unwrap();
        db::execute_sql(&db_str, "INSERT INTO users (name) VALUES ('ada'), ('bob'), ('cy')", None, OpenOptions::default())
            .await
            .unwrap();
        let project = json!({
            "version": 5, "name": "shop", "dbType": "sqlite", "dbPath": "shop.db",
            "snippets": [{"id":"s","name":"first_two","sql":"SELECT * FROM users WHERE id <= 2;","blockType":"query"}],
            "pages": [{"id":"p","name":"Main","nodes":[
                {"id":"b1","type":"sqlBlock","position":{"x":0,"y":0},
                 "data":{"title":"Count","blockType":"query","sql":"SELECT count(*) AS n FROM {{first_two}}"}}
            ],"edges":[]}]
        });
        fs::write(root.join("shop.graft"), project.to_string()).unwrap();
        (root.clone(), GraftServer::new(Roots::new(vec![root]), read_only))
    }

    fn parse(out: Result<String, String>) -> Value {
        serde_json::from_str(&out.unwrap()).unwrap()
    }

    #[tokio::test]
    async fn edits_blocks_in_the_graft_file_only() {
        let (root, server) = fixture("edit", false).await;
        let project = || "shop".to_string();

        let created = parse(
            server
                .create_block(Parameters(CreateBlockArgs {
                    project: project(),
                    title: "Names".into(),
                    sql: "SELECT name FROM users ORDER BY id".into(),
                    block_type: None,
                    page: Some("Main".into()),
                    x: None,
                    y: None,
                }))
                .await,
        );
        let id = created["id"].as_str().unwrap().to_string();
        assert_eq!(created["blockType"], "query");

        let ran = parse(
            server
                .run_block(Parameters(RunBlockArgs { project: project(), block_id: id.clone(), max_rows: None }))
                .await,
        );
        assert_eq!(ran["rows"][0][0], "ada", "the new block is runnable straight away");

        let updated = parse(
            server
                .update_block(Parameters(UpdateBlockArgs {
                    project: project(),
                    block_id: id.clone(),
                    title: None,
                    sql: Some("SELECT 1".into()),
                    block_type: Some("script".into()),
                }))
                .await,
        );
        assert_eq!((updated["title"].as_str(), updated["sql"].as_str()), (Some("Names"), Some("SELECT 1")));

        let removed = parse(
            server
                .delete_block(Parameters(BlockArgs { project: project(), block_id: id.clone() }))
                .await,
        );
        assert_eq!(removed["removed"][0], id.as_str());
        let blocks = parse(server.list_blocks(Parameters(ListBlocksArgs { project: project(), page: None })).await);
        assert_eq!(blocks.as_array().unwrap().len(), 1);

        let plan = parse(
            server
                .explain_query(Parameters(ExplainArgs { project: project(), sql: "SELECT * FROM users WHERE id = 1;".into() }))
                .await,
        );
        assert!(plan["columns"].as_array().unwrap().iter().any(|c| c == "detail"));

        let count = db::execute_sql(&root.join("shop.db").to_string_lossy(), "SELECT count(*) FROM users", None, OpenOptions::default())
            .await
            .unwrap();
        assert_eq!(count.rows[0][0], 3, "the database is never written");
        fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn read_only_mode_refuses_block_edits() {
        let (root, server) = fixture("ro", true).await;
        let before = fs::read_to_string(root.join("shop.graft")).unwrap();
        let err = server
            .update_block(Parameters(UpdateBlockArgs {
                project: "shop".into(),
                block_id: "b1".into(),
                title: Some("x".into()),
                sql: None,
                block_type: None,
            }))
            .await
            .unwrap_err();
        assert!(err.contains("--read-only"));
        assert!(server
            .delete_block(Parameters(BlockArgs { project: "shop".into(), block_id: "b1".into() }))
            .await
            .is_err());
        assert_eq!(fs::read_to_string(root.join("shop.graft")).unwrap(), before);
        // Reading still works.
        assert!(server
            .explain_query(Parameters(ExplainArgs { project: "shop".into(), sql: "SELECT 1".into() }))
            .await
            .is_ok());
        fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn tools_read_but_never_write() {
        let (root, server) = fixture("read", false).await;
        let project = || "shop".to_string();

        let listed: Value = serde_json::from_str(&server.list_projects().await.unwrap()).unwrap();
        assert_eq!(listed["projects"][0]["name"], "shop");

        let schema: Value = serde_json::from_str(
            &server.get_schema(Parameters(ProjectArgs { project: project() })).await.unwrap(),
        )
        .unwrap();
        assert_eq!(schema["source"], "live");
        assert_eq!(schema["tables"][0]["name"], "users");

        let block: Value = serde_json::from_str(
            &server
                .run_block(Parameters(RunBlockArgs { project: project(), block_id: "b1".into(), max_rows: None }))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(block["rows"][0][0], 2, "the {{first_two}} favorite was expanded");
        assert!(block["expanded_sql"].as_str().unwrap().contains("(SELECT * FROM users WHERE id <= 2)"));

        let capped: Value = serde_json::from_str(
            &server
                .run_query(Parameters(RunQueryArgs { project: project(), sql: "SELECT * FROM users".into(), max_rows: Some(1) }))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(capped["total_rows"], 3);
        assert_eq!(capped["truncated"], true);

        let write = server
            .run_query(Parameters(RunQueryArgs { project: project(), sql: "DELETE FROM users".into(), max_rows: None }))
            .await;
        assert!(write.is_err(), "read-only connection must reject writes");

        let uris: Vec<String> = server.resources().into_iter().map(|(r, _, _)| r.uri).collect();
        assert!(uris.contains(&"graft://shop/schema".to_string()));
        assert!(uris.contains(&"graft://shop/blocks/b1".to_string()));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn non_sqlite_projects_are_refused() {
        let project = Project {
            path: "/tmp/x.graft".into(),
            file: graft_core::notebook::NotebookFile::parse(
                r#"{"version":5,"name":"pg","dbType":"postgres","dbPath":"postgres://x"}"#,
            )
            .unwrap(),
        };
        assert!(sqlite_path(&project).unwrap_err().contains("only SQLite"));
    }
}
