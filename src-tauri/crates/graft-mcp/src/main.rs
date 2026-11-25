//! `graft-mcp`: a Model Context Protocol server over stdio, started by an MCP
//! client (Claude Desktop, Claude Code). It works on `.graft` files and their
//! databases directly — the Graft app does not need to be running.
//!
//! stdout carries the protocol: diagnostics go to stderr only.

mod server;
mod service;

use rmcp::ServiceExt;

use server::GraftServer;
use service::GraftService;

#[tokio::main]
async fn main() {
    let Some(registry_file) = graft_core::registry::default_path() else {
        eprintln!("graft-mcp: could not resolve the user data directory");
        std::process::exit(1);
    };
    graft_core::secrets::prepare();
    let bridge_file = graft_core::bridge::default_path();
    let server = GraftServer::new(GraftService::new(registry_file, bridge_file));
    match server.serve(rmcp::transport::stdio()).await {
        Ok(running) => {
            if let Err(e) = running.waiting().await {
                eprintln!("graft-mcp: {e}");
                std::process::exit(1);
            }
        }
        Err(e) => {
            eprintln!("graft-mcp: could not start: {e}");
            std::process::exit(1);
        }
    }
}
