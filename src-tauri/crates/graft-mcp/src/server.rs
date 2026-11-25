//! MCP protocol layer: tools, resources and prompts, all delegating to
//! `GraftService`. Tool failures are returned as error results (visible to
//! the model) rather than protocol errors.

use std::sync::Arc;

use graft_core::notebook::{BlockPatch, NewBlock};
use rmcp::handler::server::router::{prompt::PromptRouter, tool::ToolRouter};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::*;
use rmcp::service::RequestContext;
use rmcp::{prompt, prompt_handler, prompt_router, schemars, tool, tool_handler, tool_router};
use rmcp::{ErrorData as McpError, RoleServer, ServerHandler};
use serde::Deserialize;
use serde_json::Value;

use crate::service::GraftService;

const URI_PREFIX: &str = "graft://projects/";
const SCHEMA_SUFFIX: &str = "/schema";
const BLOCKS_SEGMENT: &str = "/blocks/";

const INSTRUCTIONS: &str = "Graft projects: SQL blocks laid out on a canvas, each project bound to \
a SQLite, PostgreSQL or MySQL database. Start with list_projects, then get_schema / list_blocks. \
run_query, run_block and explain_query are read-only. execute_write runs DML/DDL and only works on \
projects where the user enabled writes in Graft. Blocks you create or edit are saved to the project \
file; the Graft app offers to reload it.";

#[derive(Deserialize, schemars::JsonSchema)]
pub struct ProjectArgs {
    /// Project name (from list_projects) or the path of its .graft file.
    pub project: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct ListBlocksArgs {
    pub project: String,
    /// Only blocks of this page (page id or name).
    pub page: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct BlockArgs {
    pub project: String,
    pub block_id: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct CreateBlockArgs {
    pub project: String,
    pub sql: String,
    pub title: Option<String>,
    /// query, migration, procedure, trigger, view or script (default query).
    pub block_type: Option<String>,
    /// Page id (default: the first page).
    pub page_id: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct UpdateBlockArgs {
    pub project: String,
    pub block_id: String,
    pub sql: Option<String>,
    pub title: Option<String>,
    pub block_type: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct QueryArgs {
    pub project: String,
    pub sql: String,
    /// Rows to return (default 100, at most 1000).
    pub max_rows: Option<usize>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct RunBlockArgs {
    pub project: String,
    pub block_id: String,
    pub max_rows: Option<usize>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct WriteArgs {
    pub project: String,
    /// DML or DDL to run (possibly several statements).
    pub sql: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct InsertsArgs {
    pub project: String,
    /// Query whose rows to turn into INSERTs (or use block_id).
    pub sql: Option<String>,
    pub block_id: Option<String>,
    pub max_rows: Option<usize>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct ExplainArgs {
    pub project: String,
    pub sql: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct MigrationPromptArgs {
    pub project: String,
    /// What the migration must achieve.
    pub goal: String,
}

fn reply(outcome: Result<Value, String>) -> Result<CallToolResult, McpError> {
    Ok(match outcome {
        Ok(value) => CallToolResult::success(vec![ContentBlock::text(
            serde_json::to_string_pretty(&value).unwrap_or_default(),
        )]),
        Err(message) => CallToolResult::error(vec![ContentBlock::text(message)]),
    })
}

fn prompt_error(message: String) -> McpError {
    McpError::invalid_params(message, None)
}

/// Encode a project name for a resource URI (names may contain spaces…).
pub fn encode_segment(segment: &str) -> String {
    segment
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            other => format!("%{other:02X}"),
        })
        .collect()
}

pub fn decode_segment(segment: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(segment.len());
    let mut iter = segment.bytes();
    while let Some(b) = iter.next() {
        if b == b'%' {
            let hex = [iter.next()?, iter.next()?];
            bytes.push(u8::from_str_radix(std::str::from_utf8(&hex).ok()?, 16).ok()?);
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8(bytes).ok()
}

/// What a `graft://projects/…` URI designates.
#[derive(Debug, PartialEq)]
pub enum ResourceTarget {
    Schema { project: String },
    Block { project: String, block_id: String },
}

pub fn parse_resource_uri(uri: &str) -> Option<ResourceTarget> {
    let rest = uri.strip_prefix(URI_PREFIX)?;
    if let Some(project) = rest.strip_suffix(SCHEMA_SUFFIX) {
        return Some(ResourceTarget::Schema { project: decode_segment(project)? });
    }
    let (project, block_id) = rest.split_once(BLOCKS_SEGMENT)?;
    Some(ResourceTarget::Block { project: decode_segment(project)?, block_id: decode_segment(block_id)? })
}

#[derive(Clone)]
pub struct GraftServer {
    service: Arc<GraftService>,
    tool_router: ToolRouter<Self>,
    prompt_router: PromptRouter<Self>,
}

#[tool_router]
impl GraftServer {
    pub fn new(service: GraftService) -> Self {
        GraftServer {
            service: Arc::new(service),
            tool_router: Self::tool_router(),
            prompt_router: Self::prompt_router(),
        }
    }

    #[tool(description = "List the Graft projects known on this machine (name, path, engine, whether writes are enabled).")]
    async fn list_projects(&self) -> Result<CallToolResult, McpError> {
        reply(self.service.list_projects())
    }

    #[tool(description = "Database structure of a project: tables and views with columns, keys, indexes; triggers; procedures and functions.")]
    async fn get_schema(&self, Parameters(args): Parameters<ProjectArgs>) -> Result<CallToolResult, McpError> {
        reply(self.service.get_schema(&args.project).await)
    }

    #[tool(description = "List the SQL blocks of a project (id, page, title, type, SQL preview).")]
    async fn list_blocks(&self, Parameters(args): Parameters<ListBlocksArgs>) -> Result<CallToolResult, McpError> {
        reply(self.service.list_blocks(&args.project, args.page.as_deref()))
    }

    #[tool(description = "Read one SQL block (full SQL, title, type, page, position).")]
    async fn read_block(&self, Parameters(args): Parameters<BlockArgs>) -> Result<CallToolResult, McpError> {
        reply(self.service.read_block(&args.project, &args.block_id))
    }

    #[tool(description = "Create a SQL block in a project (saved to the .graft file; nothing is executed).")]
    async fn create_block(&self, Parameters(args): Parameters<CreateBlockArgs>) -> Result<CallToolResult, McpError> {
        let new = NewBlock {
            title: args.title,
            block_type: args.block_type,
            sql: args.sql,
            page_id: args.page_id,
            x: args.x,
            y: args.y,
        };
        reply(self.service.create_block(&args.project, new).await)
    }

    #[tool(description = "Change a block's SQL, title, type or position (saved to the .graft file; nothing is executed).")]
    async fn update_block(&self, Parameters(args): Parameters<UpdateBlockArgs>) -> Result<CallToolResult, McpError> {
        let patch = BlockPatch { title: args.title, block_type: args.block_type, sql: args.sql, x: args.x, y: args.y };
        reply(self.service.update_block(&args.project, &args.block_id, patch).await)
    }

    #[tool(description = "Run one read-only SQL statement on the project's database. Writes are refused (use execute_write).")]
    async fn run_query(&self, Parameters(args): Parameters<QueryArgs>) -> Result<CallToolResult, McpError> {
        reply(self.service.run_query(&args.project, &args.sql, args.max_rows).await)
    }

    #[tool(description = "Run a block's SQL read-only, with {{favorite}} references expanded as in Graft.")]
    async fn run_block(&self, Parameters(args): Parameters<RunBlockArgs>) -> Result<CallToolResult, McpError> {
        reply(self.service.run_block(&args.project, &args.block_id, args.max_rows).await)
    }

    #[tool(description = "Run DML/DDL that modifies the database. Only allowed for projects where the user enabled Claude writes in Graft.")]
    async fn execute_write(&self, Parameters(args): Parameters<WriteArgs>) -> Result<CallToolResult, McpError> {
        reply(self.service.execute_write(&args.project, &args.sql).await)
    }

    #[tool(description = "Generate INSERT statements reproducing the rows of a read-only query or of a block, for the best-matching table.")]
    async fn generate_inserts(&self, Parameters(args): Parameters<InsertsArgs>) -> Result<CallToolResult, McpError> {
        reply(
            self.service
                .generate_inserts(&args.project, args.sql.as_deref(), args.block_id.as_deref(), args.max_rows)
                .await,
        )
    }

    #[tool(description = "Show the execution plan of a statement (EXPLAIN, never ANALYZE: nothing is executed).")]
    async fn explain_query(&self, Parameters(args): Parameters<ExplainArgs>) -> Result<CallToolResult, McpError> {
        reply(self.service.explain_query(&args.project, &args.sql).await)
    }
}

#[prompt_router]
impl GraftServer {
    #[prompt(name = "write_migration", description = "Write a migration for a Graft project's database.")]
    async fn write_migration(
        &self,
        Parameters(args): Parameters<MigrationPromptArgs>,
    ) -> Result<GetPromptResult, McpError> {
        let schema = self.service.schema_summary(&args.project).await.map_err(prompt_error)?;
        Ok(GetPromptResult::new(vec![PromptMessage::new_text(
            Role::User,
            format!(
                "Write a migration for this database so that: {}\n\nCurrent schema:\n{schema}\n\n\
                 Use the engine's dialect, keep it idempotent where possible, include a rollback, \
                 and save it with create_block (block_type \"migration\") rather than executing it.",
                args.goal
            ),
        )]))
    }

    #[prompt(name = "explain_plan", description = "Explain the execution plan of a query and suggest improvements.")]
    async fn explain_plan(&self, Parameters(args): Parameters<ExplainArgs>) -> Result<GetPromptResult, McpError> {
        let plan = self.service.explain_query(&args.project, &args.sql).await.map_err(prompt_error)?;
        Ok(GetPromptResult::new(vec![PromptMessage::new_text(
            Role::User,
            format!(
                "Explain this execution plan step by step for a DBA, point out costly operations and \
                 suggest indexes or rewrites.\n\nQuery:\n{}\n\nPlan:\n{}",
                args.sql,
                serde_json::to_string_pretty(&plan).unwrap_or_default()
            ),
        )]))
    }

    #[prompt(name = "document_schema", description = "Write documentation for a Graft project's database schema.")]
    async fn document_schema(&self, Parameters(args): Parameters<ProjectArgs>) -> Result<GetPromptResult, McpError> {
        let schema = self.service.schema_summary(&args.project).await.map_err(prompt_error)?;
        Ok(GetPromptResult::new(vec![PromptMessage::new_text(
            Role::User,
            format!(
                "Document this database schema: purpose of each table, columns, relations (foreign \
                 keys) and notable constraints or indexes. Output Markdown.\n\n{schema}"
            ),
        )]))
    }
}

#[tool_handler(router = self.tool_router)]
#[prompt_handler(router = self.prompt_router)]
impl ServerHandler for GraftServer {
    fn get_info(&self) -> ServerConfig {
        let mut info = ServerConfig::new(
            ServerCapabilities::builder().enable_tools().enable_prompts().enable_resources().build(),
        );
        info.instructions = Some(INSTRUCTIONS.into());
        info.server_info = Implementation::new("graft", env!("CARGO_PKG_VERSION"));
        info
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        let projects = self.service.list_projects().map_err(|e| McpError::internal_error(e, None))?;
        let mut resources = Vec::new();
        for project in projects.as_array().into_iter().flatten() {
            let Some(name) = project["name"].as_str() else { continue };
            let encoded = encode_segment(name);
            resources.push(
                Resource::new(format!("{URI_PREFIX}{encoded}{SCHEMA_SUFFIX}"), format!("{name} — schema"))
                    .with_mime_type("application/json"),
            );
            let Ok(blocks) = self.service.list_blocks(name, None) else { continue };
            for block in blocks.as_array().into_iter().flatten() {
                let (Some(id), Some(title)) = (block["id"].as_str(), block["title"].as_str()) else { continue };
                resources.push(
                    Resource::new(
                        format!("{URI_PREFIX}{encoded}{BLOCKS_SEGMENT}{}", encode_segment(id)),
                        format!("{name} — {title}"),
                    )
                    .with_mime_type("application/sql"),
                );
            }
        }
        Ok(ListResourcesResult::with_all_items(resources))
    }

    async fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, McpError> {
        Ok(ListResourceTemplatesResult::with_all_items(vec![
            ResourceTemplate::new(format!("{URI_PREFIX}{{project}}{SCHEMA_SUFFIX}"), "Project schema")
                .with_mime_type("application/json"),
            ResourceTemplate::new(format!("{URI_PREFIX}{{project}}{BLOCKS_SEGMENT}{{block_id}}"), "Block SQL")
                .with_mime_type("application/sql"),
        ]))
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, McpError> {
        let not_found = || McpError::invalid_params(format!("unknown resource {}", request.uri), None);
        let text = match parse_resource_uri(&request.uri).ok_or_else(not_found)? {
            ResourceTarget::Schema { project } => {
                let schema = self.service.get_schema(&project).await.map_err(prompt_error)?;
                serde_json::to_string_pretty(&schema).unwrap_or_default()
            }
            ResourceTarget::Block { project, block_id } => {
                let block = self.service.read_block(&project, &block_id).map_err(prompt_error)?;
                block["sql"].as_str().unwrap_or_default().to_string()
            }
        };
        Ok(ReadResourceResult::new(vec![ResourceContents::text(text, request.uri)]).into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_uris_round_trip() {
        let encoded = encode_segment("my shop/é");
        assert_eq!(decode_segment(&encoded).as_deref(), Some("my shop/é"));
        assert_eq!(
            parse_resource_uri(&format!("graft://projects/{encoded}/schema")),
            Some(ResourceTarget::Schema { project: "my shop/é".into() })
        );
        assert_eq!(
            parse_resource_uri("graft://projects/shop/blocks/block-1"),
            Some(ResourceTarget::Block { project: "shop".into(), block_id: "block-1".into() })
        );
        assert_eq!(parse_resource_uri("file:///etc/passwd"), None);
    }
}
