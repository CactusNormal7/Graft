// Install sql-language-server where Graft looks for it:
// <user data dir>/Graft/sql-language-server (see src-tauri/src/lsp.rs).
//
// The published 1.7.1 package breaks with the vscode-languageserver-protocol
// version npm resolves by default (ERR_PACKAGE_PATH_NOT_EXPORTED on
// lib/common/protocol), so 3.16.0 is pinned next to it. Install scripts are
// skipped: they only build the native sqlite3 driver, which Graft never uses
// (it never hands a database connection to the server).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const SERVER_VERSION = "1.7.1";
const PROTOCOL_VERSION = "3.16.0";

function userDataDir() {
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support");
  if (platform() === "win32") return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
}

const target = join(userDataDir(), "Graft", "sql-language-server");
mkdirSync(target, { recursive: true });
const manifest = join(target, "package.json");
if (!existsSync(manifest)) {
  writeFileSync(manifest, JSON.stringify({ name: "graft-sql-language-server", private: true }, null, 2));
}

const npm = platform() === "win32" ? "npm.cmd" : "npm";
execFileSync(
  npm,
  [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    `sql-language-server@${SERVER_VERSION}`,
    `vscode-languageserver-protocol@${PROTOCOL_VERSION}`,
  ],
  { cwd: target, stdio: "inherit", shell: platform() === "win32" },
);
process.stdout.write(`sql-language-server installed in ${target}\n`);
