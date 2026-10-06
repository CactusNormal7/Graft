//! `graft-mcp` — Model Context Protocol server (stdio) exposing Graft projects
//! to Claude (Claude Code, Claude Desktop). Databases are always read-only;
//! SQL blocks in `.graft` files can be created, edited and deleted unless the
//! server runs with `--read-only`.
//!
//! Usage: `graft-mcp [--root <dir>]... [--read-only]`
//! Projects are discovered under `<Documents|Home>/Graft` (the app's default
//! project directory), every `--root`, and every directory listed in the
//! `GRAFT_PROJECT_DIRS` environment variable (OS path-list separator).
//! `GRAFT_MCP_READ_ONLY=1` is equivalent to `--read-only`.
//! stdout carries the protocol: diagnostics go to stderr only.

mod projects;
mod server;

use std::env;
use std::path::PathBuf;

use graft_core::files::default_project_dir_path;
use rmcp::{transport::stdio, ServiceExt};

use crate::projects::Roots;
use crate::server::GraftServer;

/// Command-line / environment configuration.
struct Config {
    dirs: Vec<PathBuf>,
    read_only: bool,
}

fn config_from_env_and_args() -> Result<Config, String> {
    let mut dirs = Vec::new();
    let mut read_only = env::var("GRAFT_MCP_READ_ONLY").is_ok_and(|v| v == "1" || v == "true");
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
            "--read-only" => read_only = true,
            "-h" | "--help" => {
                eprintln!(
                    "usage: graft-mcp [--root <dir>]... [--read-only]  \
                     (also reads GRAFT_PROJECT_DIRS, GRAFT_MCP_READ_ONLY)"
                );
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument {other:?} (try --help)")),
        }
    }
    Ok(Config { dirs, read_only })
}

#[tokio::main]
async fn main() {
    let config = match config_from_env_and_args() {
        Ok(config) => config,
        Err(e) => {
            eprintln!("graft-mcp: {e}");
            std::process::exit(2);
        }
    };
    let roots = Roots::new(config.dirs);
    eprintln!(
        "graft-mcp: serving projects under {:?}{}",
        roots.dirs(),
        if config.read_only { " (read-only)" } else { "" }
    );

    let service = match GraftServer::new(roots, config.read_only).serve(stdio()).await {
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
