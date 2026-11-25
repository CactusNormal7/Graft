//! What the MCP tools do, independent of the protocol layer (`server.rs`) so
//! it can be tested directly.
//!
//! Guardrails (docs/technique.md § Intégration Claude):
//! - only projects of the registry are reachable — never a path the client
//!   makes up — and only `.graft` files are read or written;
//! - queries run read-only (`execute_read_only`); writes go through
//!   `execute_write`, refused unless enabled for that project in the app;
//! - results are capped (`DEFAULT_MAX_ROWS`, at most `MAX_ROWS_LIMIT`);
//! - no credential is ever returned: passwords stay in the OS keychain and
//!   connection details are reduced to engine + database name.

use std::path::{Path, PathBuf};

use graft_core::db::{self, ConnectionConfig, Databases, Engine, QueryResult, SqlError};
use graft_core::files::{read_project, write_project};
use graft_core::inserts::generate_inserts;
use graft_core::notebook::{expand_snippets, BlockPatch, NewBlock, Notebook};
use graft_core::registry::{KnownProject, Registry};
use graft_core::secrets;
use serde_json::{json, Value};

/// Rows returned when the client does not say: enough to reason about a
/// result without flooding the model's context.
pub const DEFAULT_MAX_ROWS: usize = 100;
/// Hard ceiling, whatever the client asks.
pub const MAX_ROWS_LIMIT: usize = 1_000;
/// Length of the SQL preview in `list_blocks`.
const SQL_PREVIEW_CHARS: usize = 80;

pub fn clamp_rows(requested: Option<usize>) -> usize {
    requested.unwrap_or(DEFAULT_MAX_ROWS).clamp(1, MAX_ROWS_LIMIT)
}

fn describe_sql_error(err: SqlError) -> String {
    match err.position {
        Some(position) => format!("{} (at character {position})", err.message),
        None => err.message,
    }
}

fn result_json(result: &QueryResult) -> Value {
    json!({
        "columns": result.columns,
        "rows": result.rows,
        "row_count": result.rows.len(),
        "total_rows": result.total_rows,
        "truncated": result.truncated,
        "rows_affected": result.rows_affected,
        "elapsed_ms": result.elapsed_ms,
    })
}

fn engine_name(engine: Engine) -> &'static str {
    match engine {
        Engine::Sqlite => "sqlite",
        Engine::Postgres => "postgres",
        Engine::Mysql => "mysql",
    }
}

/// The statement that shows `sql`'s plan without running it.
pub fn explain_statement(engine: Engine, sql: &str) -> String {
    let statement = sql.trim().trim_end_matches(';');
    match engine {
        Engine::Sqlite => format!("EXPLAIN QUERY PLAN {statement}"),
        // Never ANALYZE: that would execute the statement.
        Engine::Postgres | Engine::Mysql => format!("EXPLAIN {statement}"),
    }
}

pub struct GraftService {
    registry_file: PathBuf,
    databases: Databases,
}

/// A project opened for one tool call.
pub struct OpenProject {
    pub entry: KnownProject,
    pub notebook: Notebook,
}

impl OpenProject {
    fn connection(&self) -> Result<ConnectionConfig, String> {
        self.notebook
            .connection()
            .ok_or_else(|| format!("project {:?} has no database connection", self.entry.name))
    }

    fn save(&self) -> Result<(), String> {
        write_project(Path::new(&self.entry.path), &self.notebook.to_json())
    }
}

impl GraftService {
    pub fn new(registry_file: PathBuf) -> Self {
        GraftService { registry_file, databases: Databases::default() }
    }

    fn registry(&self) -> Result<Registry, String> {
        Registry::load(&self.registry_file)
    }

    pub fn open(&self, project: &str) -> Result<OpenProject, String> {
        let entry = self.registry()?.find(project)?.clone();
        let notebook = Notebook::parse(&read_project(Path::new(&entry.path))?)?;
        Ok(OpenProject { entry, notebook })
    }

    fn password(connection: &ConnectionConfig) -> Result<Option<String>, String> {
        match connection.engine {
            Engine::Sqlite => Ok(None),
            Engine::Postgres | Engine::Mysql => secrets::password(&connection.id),
        }
    }

    async fn read_only(&self, project: &OpenProject, sql: &str, max_rows: usize) -> Result<QueryResult, String> {
        let connection = project.connection()?;
        let password = Self::password(&connection)?;
        db::execute_read_only(&connection, password.as_deref(), sql, max_rows)
            .await
            .map_err(describe_sql_error)
    }

    pub fn list_projects(&self) -> Result<Value, String> {
        let projects: Vec<Value> = self
            .registry()?
            .projects
            .iter()
            .map(|entry| {
                // A project file that cannot be read is still listed, flagged.
                let connection = read_project(Path::new(&entry.path))
                    .ok()
                    .and_then(|json| Notebook::parse(&json).ok())
                    .and_then(|notebook| notebook.connection());
                json!({
                    "name": entry.name,
                    "path": entry.path,
                    "engine": connection.as_ref().map(|c| engine_name(c.engine)),
                    "database": connection.as_ref().and_then(|c| c.database.clone()),
                    "writes_enabled": entry.allow_mcp_writes,
                    "readable": connection.is_some(),
                })
            })
            .collect();
        Ok(json!(projects))
    }

    /// Live structure; falls back to the structure cached in the project
    /// when the database cannot be reached.
    pub async fn get_schema(&self, project: &str) -> Result<Value, String> {
        let project = self.open(project)?;
        let connection = project.connection()?;
        let password = Self::password(&connection)?;
        match self.databases.introspect(&connection, password.as_deref()).await {
            Ok(snapshot) => Ok(json!({ "engine": engine_name(connection.engine), "live": true, "schema": snapshot })),
            Err(err) => Ok(json!({
                "engine": engine_name(connection.engine),
                "live": false,
                "error": describe_sql_error(err),
                "schema": { "tables": project.notebook.cached_tables(), "triggers": [], "routines": [] },
            })),
        }
    }

    pub fn list_blocks(&self, project: &str, page: Option<&str>) -> Result<Value, String> {
        let project = self.open(project)?;
        let blocks: Vec<Value> = project
            .notebook
            .blocks()
            .into_iter()
            .filter(|b| page.is_none_or(|p| b.page_id.as_deref() == Some(p) || b.page_name == p))
            .map(|b| {
                let preview: String = b.sql.split_whitespace().collect::<Vec<_>>().join(" ");
                json!({
                    "id": b.id,
                    "page": b.page_name,
                    "page_id": b.page_id,
                    "title": b.title,
                    "block_type": b.block_type,
                    "sql_preview": preview.chars().take(SQL_PREVIEW_CHARS).collect::<String>(),
                })
            })
            .collect();
        Ok(json!(blocks))
    }

    pub fn read_block(&self, project: &str, block_id: &str) -> Result<Value, String> {
        let project = self.open(project)?;
        let block = project.notebook.block(block_id).ok_or_else(|| format!("no block with id {block_id:?}"))?;
        Ok(json!(block))
    }

    pub fn create_block(&self, project: &str, new: NewBlock) -> Result<Value, String> {
        let mut project = self.open(project)?;
        let block = project.notebook.create_block(new)?;
        project.save()?;
        Ok(json!(block))
    }

    pub fn update_block(&self, project: &str, block_id: &str, patch: BlockPatch) -> Result<Value, String> {
        let mut project = self.open(project)?;
        let block = project.notebook.update_block(block_id, patch)?;
        project.save()?;
        Ok(json!(block))
    }

    pub async fn run_query(&self, project: &str, sql: &str, max_rows: Option<usize>) -> Result<Value, String> {
        let project = self.open(project)?;
        let result = self.read_only(&project, sql, clamp_rows(max_rows)).await?;
        Ok(result_json(&result))
    }

    /// Run a block's SQL, `{{favorites}}` expanded as the app does. Read-only.
    pub async fn run_block(&self, project: &str, block_id: &str, max_rows: Option<usize>) -> Result<Value, String> {
        let project = self.open(project)?;
        let block = project.notebook.block(block_id).ok_or_else(|| format!("no block with id {block_id:?}"))?;
        let sql = expand_snippets(&block.sql, &project.notebook.snippets());
        let result = self.read_only(&project, &sql, clamp_rows(max_rows)).await?;
        Ok(json!({ "executed_sql": sql, "result": result_json(&result) }))
    }

    /// DML/DDL, only for projects where the user enabled it in the app.
    pub async fn execute_write(&self, project: &str, sql: &str) -> Result<Value, String> {
        let project = self.open(project)?;
        if !project.entry.allow_mcp_writes {
            return Err(format!(
                "writes are disabled for project {:?}: enable \"Allow Claude to modify this database\" \
                 in Graft's connection dialog first",
                project.entry.name
            ));
        }
        let connection = project.connection()?;
        let password = Self::password(&connection)?;
        let result = self
            .databases
            .execute(&connection, password.as_deref(), sql, DEFAULT_MAX_ROWS)
            .await
            .map_err(describe_sql_error)?;
        Ok(result_json(&result))
    }

    /// INSERT statements reproducing the rows of a query or of a block.
    pub async fn generate_inserts(
        &self,
        project: &str,
        sql: Option<&str>,
        block_id: Option<&str>,
        max_rows: Option<usize>,
    ) -> Result<Value, String> {
        let open = self.open(project)?;
        let sql = match (sql, block_id) {
            (Some(sql), None) => sql.to_string(),
            (None, Some(id)) => {
                let block = open.notebook.block(id).ok_or_else(|| format!("no block with id {id:?}"))?;
                expand_snippets(&block.sql, &open.notebook.snippets())
            }
            _ => return Err("pass exactly one of `sql` or `block_id`".into()),
        };
        let result = self.read_only(&open, &sql, clamp_rows(max_rows)).await?;
        let connection = open.connection()?;
        let password = Self::password(&connection)?;
        let tables = match self.databases.introspect(&connection, password.as_deref()).await {
            Ok(snapshot) => snapshot.tables,
            Err(_) => open.notebook.cached_tables(),
        };
        let script = generate_inserts(&result, &tables, connection.engine);
        Ok(json!({ "sql": script.sql, "warnings": script.warnings }))
    }

    pub async fn explain_query(&self, project: &str, sql: &str) -> Result<Value, String> {
        let open = self.open(project)?;
        let engine = open.connection()?.engine;
        let result = self.read_only(&open, &explain_statement(engine, sql), MAX_ROWS_LIMIT).await?;
        Ok(json!({ "engine": engine_name(engine), "plan": result_json(&result) }))
    }

    /// Compact text description of the schema, for prompts.
    pub async fn schema_summary(&self, project: &str) -> Result<String, String> {
        let schema = self.get_schema(project).await?;
        let mut lines = vec![format!("Engine: {}", schema["engine"].as_str().unwrap_or("unknown"))];
        for table in schema["schema"]["tables"].as_array().into_iter().flatten() {
            let columns: Vec<String> = table["columns"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|c| {
                    let pk = if c["pk"].as_bool() == Some(true) { " PK" } else { "" };
                    format!("{} {}{pk}", c["name"].as_str().unwrap_or(""), c["data_type"].as_str().unwrap_or(""))
                })
                .collect();
            let qualified = match table["schema"].as_str() {
                Some(schema) => format!("{schema}.{}", table["name"].as_str().unwrap_or("")),
                None => table["name"].as_str().unwrap_or("").to_string(),
            };
            lines.push(format!("{} {qualified} ({})", table["kind"].as_str().unwrap_or("table"), columns.join(", ")));
            for fk in table["foreign_keys"].as_array().into_iter().flatten() {
                lines.push(format!(
                    "  FK {} -> {}.{}",
                    fk["column"].as_str().unwrap_or(""),
                    fk["to_table"].as_str().unwrap_or(""),
                    fk["to_column"].as_str().unwrap_or("")
                ));
            }
        }
        Ok(lines.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        dir: PathBuf,
        service: GraftService,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.dir).ok();
        }
    }

    async fn fixture(tag: &str) -> Fixture {
        let dir = std::env::temp_dir().join(format!("graft-mcp-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("shop.db");
        let config = ConnectionConfig {
            id: "local".into(),
            engine: Engine::Sqlite,
            path: Some(db_path.to_string_lossy().into_owned()),
            host: None,
            port: None,
            database: None,
            user: None,
            ssl_mode: Default::default(),
        };
        Databases::default()
            .execute(
                &config,
                None,
                "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\
                 INSERT INTO users (name) VALUES ('ada'), ('linus');",
                10,
            )
            .await
            .unwrap();
        let project = json!({
            "version": 6, "name": "shop", "dbType": "sqlite", "dbPath": config.path,
            "connection": config,
            "snippets": [{ "id": "s1", "name": "first", "sql": "SELECT * FROM users WHERE id = 1;", "blockType": "query" }],
            "pages": [{ "id": "p1", "name": "Main", "nodes": [
                { "id": "b1", "type": "sqlBlock", "position": { "x": 80, "y": 80 },
                  "data": { "title": "First user", "blockType": "query", "sql": "SELECT name FROM {{first}} f" } }
            ], "edges": [] }],
        });
        let project_path = dir.join("shop.graft");
        std::fs::write(&project_path, project.to_string()).unwrap();
        let registry_file = dir.join("projects.json");
        let mut registry = Registry::default();
        registry.register(&project_path.to_string_lossy(), "shop");
        registry.save(&registry_file).unwrap();
        Fixture { dir, service: GraftService::new(registry_file) }
    }

    #[tokio::test]
    async fn only_known_projects_are_reachable() {
        let f = fixture("known").await;
        let projects = f.service.list_projects().unwrap();
        assert_eq!(projects[0]["name"], json!("shop"));
        assert_eq!(projects[0]["engine"], json!("sqlite"));
        assert_eq!(projects[0]["writes_enabled"], json!(false));
        assert!(projects[0].get("connection").is_none(), "no connection details leak");
        assert!(f.service.list_blocks("/etc/passwd", None).is_err());
        assert!(f.service.list_blocks("other", None).is_err());
    }

    #[tokio::test]
    async fn reads_creates_and_updates_blocks() {
        let f = fixture("blocks").await;
        let blocks = f.service.list_blocks("shop", Some("Main")).unwrap();
        assert_eq!(blocks[0]["sql_preview"], json!("SELECT name FROM {{first}} f"));

        let created = f
            .service
            .create_block("shop", NewBlock { sql: "SELECT count(*) FROM users".into(), ..Default::default() })
            .unwrap();
        let id = created["id"].as_str().unwrap().to_string();
        f.service
            .update_block("shop", &id, BlockPatch { title: Some("Count".into()), ..Default::default() })
            .unwrap();
        let reread = f.service.read_block("shop", &id).unwrap();
        assert_eq!(reread["title"], json!("Count"));
        assert_eq!(f.service.list_blocks("shop", None).unwrap().as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn queries_are_read_only_and_capped() {
        let f = fixture("ro").await;
        let result = f.service.run_query("shop", "SELECT * FROM users", Some(1)).await.unwrap();
        assert_eq!(result["row_count"], json!(1));
        assert_eq!(result["total_rows"], json!(2));
        assert!(f.service.run_query("shop", "DELETE FROM users", None).await.is_err());
        assert_eq!(clamp_rows(Some(1_000_000)), MAX_ROWS_LIMIT);

        let block = f.service.run_block("shop", "b1", None).await.unwrap();
        assert_eq!(block["executed_sql"], json!("SELECT name FROM (SELECT * FROM users WHERE id = 1) f"));
        assert_eq!(block["result"]["rows"][0][0], json!("ada"));
    }

    #[tokio::test]
    async fn writes_need_the_project_opt_in() {
        let f = fixture("writes").await;
        let refused = f.service.execute_write("shop", "DELETE FROM users WHERE id = 2").await;
        assert!(refused.unwrap_err().contains("writes are disabled"));

        let mut registry = Registry::load(&f.service.registry_file).unwrap();
        let path = registry.projects[0].path.clone();
        registry.set_mcp_writes(&path, true).unwrap();
        registry.save(&f.service.registry_file).unwrap();
        let done = f.service.execute_write("shop", "DELETE FROM users WHERE id = 2").await.unwrap();
        assert_eq!(done["rows_affected"], json!(1));
    }

    #[tokio::test]
    async fn generates_inserts_and_explains_plans() {
        let f = fixture("tools").await;
        let inserts = f.service.generate_inserts("shop", Some("SELECT id, name FROM users"), None, None).await.unwrap();
        assert!(inserts["sql"].as_str().unwrap().contains("INSERT INTO \"users\" (\"id\", \"name\") VALUES (1, 'ada');"));
        assert!(f.service.generate_inserts("shop", None, None, None).await.is_err());

        let plan = f.service.explain_query("shop", "SELECT * FROM users WHERE id = 1;").await.unwrap();
        assert!(plan["plan"]["row_count"].as_u64().unwrap() >= 1);
        assert_eq!(explain_statement(Engine::Postgres, "SELECT 1;"), "EXPLAIN SELECT 1");

        let summary = f.service.schema_summary("shop").await.unwrap();
        assert!(summary.contains("table users (id INTEGER PK, name TEXT)"), "{summary}");
    }
}
