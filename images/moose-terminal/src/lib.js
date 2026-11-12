// Shared by server.js and attach.js: the path check and the tmux session names.
//
// Every path comes from a URL, so none is trusted. A folder is written as its
// path under /moose: "projects/<path>" or "extra/<Name>/<path>". It must be a
// directory inside a mounted folder, with no "." or ".." part, and its real
// path (after every symlink) must still be inside that mounted folder.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MOOSE = process.env.MOOSE_ROOT || "/moose";
const PROJECTS = path.join(MOOSE, "projects");
const EXTRA = path.join(MOOSE, "extra");

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// The mounted folder a path starts in, as [root dir, number of parts it uses].
function rootOf(parts) {
  if (parts[0] === "projects") return [PROJECTS, 1];
  if (parts[0] === "extra" && parts.length >= 2) return [path.join(EXTRA, parts[1]), 2];
  return [null, 0];
}

// Returns { rel, dir } for a safe folder, or null. `rel` is the clean form of
// the path ("projects/app"), `dir` the real directory to open.
function resolveFolder(rel) {
  if (typeof rel !== "string" || rel.length > 4096 || rel.includes("\0")) return null;
  const parts = rel.split("/").filter((p) => p !== "");
  if (parts.some((p) => p === "." || p === "..")) return null;
  const [root, used] = rootOf(parts);
  if (!root) return null;
  let rootReal;
  let real;
  try {
    rootReal = fs.realpathSync(root);
    real = fs.realpathSync(path.join(root, ...parts.slice(used)));
  } catch {
    return null;
  }
  // The mounted folder itself must not be a symlink, and the target must stay inside it.
  if (rootReal !== root) return null;
  if (real !== rootReal && !real.startsWith(rootReal + "/")) return null;
  if (!isDir(real)) return null;
  return { rel: parts.join("/"), dir: real };
}

// One tmux session per folder. tmux names cannot hold "." or ":", so the name
// is a hash of the clean path.
function sessionName(rel) {
  return "m" + crypto.createHash("sha256").update(rel).digest("hex").slice(0, 16);
}

// When each folder was last opened, kept in the persisted home.
function stateDir() {
  return path.join(process.env.HOME || "/tmp", ".local", "state", "moose-terminal");
}

function readRecent() {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir(), "recent.json"), "utf8"));
  } catch {
    return {};
  }
}

function markUsed(rel) {
  const dir = stateDir();
  const recent = readRecent();
  recent[rel] = Date.now();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `recent.json.${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(recent));
  fs.renameSync(tmp, path.join(dir, "recent.json"));
}

module.exports = { MOOSE, PROJECTS, EXTRA, isDir, resolveFolder, sessionName, readRecent, markUsed };
