// Build the sidecar binaries bundled with the app (Tauri `externalBin`, see
// src-tauri/tauri.bundle.conf.json): today, the graft-mcp server.
//
// Tauri expects `src-tauri/binaries/<name>-<target triple>[.exe]` and installs
// it next to the app executable, where `install_claude_desktop` finds it.
// Run on each shipping platform (macOS, Windows): it builds for the host.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SIDECARS = ["graft-mcp"];
const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const tauriDir = join(root, "src-tauri");
const exe = process.platform === "win32" ? ".exe" : "";

const rustInfo = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
const triple = /^host: (\S+)$/m.exec(rustInfo)?.[1];
if (!triple) throw new Error("could not read the host target triple from `rustc -vV`");

mkdirSync(join(tauriDir, "binaries"), { recursive: true });
for (const name of SIDECARS) {
  execFileSync("cargo", ["build", "--release", "-p", name], { cwd: tauriDir, stdio: "inherit" });
  const target = join(tauriDir, "binaries", `${name}-${triple}${exe}`);
  copyFileSync(join(tauriDir, "target", "release", `${name}${exe}`), target);
  process.stdout.write(`sidecar ready: ${target}\n`);
}
