//! `graft-mcp` — Model Context Protocol server (stdio) exposing Graft projects
//! to Claude (Claude Code, Claude Desktop) read-only.
//!
//! Usage: `graft-mcp [--root <dir>]...`
//! Projects are discovered under `<Documents|Home>/Graft` (the app's default
//! project directory), every `--root`, and every directory listed in the
//! `GRAFT_PROJECT_DIRS` environment variable (OS path-list separator).
//! stdout carries the protocol: diagnostics go to stderr only.

mod projects;
mod server;

use std::env;
use std::path::PathBuf;

use graft_core::files::default_project_dir_path;
use rmcp::{transport::stdio, ServiceExt};

use crate::projects::Roots;
use crate::server::GraftServer;

fn roots_from_env_and_args() -> Result<Vec<PathBuf>, String> {
    let mut dirs = Vec::new();
    if let Ok(dir) = default_project_dir_path() {
        dirs.push(dir);
    }
    if let Some(list) = env::var_os("GRAFT_PROJECT_DIRS") {
        dirs.extend(env::split_paths(&list).filter(|p| !p.as_os_str().is_empty()));
    }
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--root" => dirs.push(args.next().ok_or("--root needs a directory")?.into()),
            "-h" | "--help" => {
                eprintln!("usage: graft-mcp [--root <dir>]...  (also reads GRAFT_PROJECT_DIRS)");
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument {other:?} (try --help)")),
        }
    }
    Ok(dirs)
}

#[tokio::main]
async fn main() {
    let roots = match roots_from_env_and_args() {
        Ok(dirs) => Roots::new(dirs),
        Err(e) => {
            eprintln!("graft-mcp: {e}");
            std::process::exit(2);
        }
    };
    eprintln!("graft-mcp: serving projects under {:?}", roots.dirs());

    let service = match GraftServer::new(roots).serve(stdio()).await {
        Ok(service) => service,
        Err(e) => {
            eprintln!("graft-mcp: failed to start: {e}");
            std::process::exit(1);
        }
    };
    if let Err(e) = service.waiting().await {
        eprintln!("graft-mcp: {e}");
        std::process::exit(1);
    }
}
