// The one HTTP port of a terminal app. It serves:
//   /                         the project page
//   /p/<folder>/<path>        the terminal page for that folder
//   /clone?repo=<url>&into=<folder>   a page that clones a repo into a folder
//   /tty/...                  ttyd (xterm.js and its WebSocket), proxied from a unix socket
// A <folder> is written as its path under /moose: "projects/<path>" or
// "extra/<Name>/<path>". No dependencies: only Node's own modules.
"use strict";

const { execFile, spawn, spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { PROJECTS, EXTRA, resolveFolder, sessionName, readRecent } = require("./lib");

const PORT = Number(process.env.PORT || 7681);
const SOCK = "/tmp/moose-terminal/ttyd.sock";
const STATIC = path.join(__dirname, "static");
const TMUX = ["-f", path.join(__dirname, "tmux.conf")];
const APP = process.env.MOOSE_TERMINAL_NAME || "Terminal";

// --- ttyd ------------------------------------------------------------------

fs.mkdirSync(path.dirname(SOCK), { recursive: true, mode: 0o700 });
fs.rmSync(SOCK, { force: true });
// -a: the folder comes from the URL (?arg=), and attach.js checks it again.
// -W: let the tab type (ttyd is read-only by default).
// -O: refuse a WebSocket whose Origin is not this host.
// A unix socket keeps ttyd off the network: only this server reaches it.
const ttyd = spawn("ttyd", ["-i", SOCK, "-b", "/tty", "-a", "-W", "-O",
  "-t", "disableLeaveAlert=true", "-t", "fontSize=15", "-t", `titleFixed=${APP}`,
  "node", path.join(__dirname, "attach.js")], { stdio: "inherit" });
ttyd.on("exit", (code, sig) => {
  console.error(`ttyd stopped (${sig || code}), stopping too`);
  process.exit(1);
});
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => { ttyd.kill(); process.exit(0); });

// --- helpers ---------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const folderUrl = (rel) => "/p/" + rel.split("/").map(encodeURIComponent).join("/");

const HEADERS = {
  "Content-Security-Policy": "default-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Cache-Control": "no-store",
};

function send(res, status, body, type = "text/html; charset=utf-8", extra = {}) {
  res.writeHead(status, { ...HEADERS, "Content-Type": type, ...extra });
  res.end(body);
}

function redirect(res, to) {
  res.writeHead(303, { ...HEADERS, Location: to });
  res.end();
}

function page(title, body, opts = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content">
<title>${esc(title)}</title><link rel="stylesheet" href="/static/style.css"></head>
<body class="${opts.cls || ""}">${body}<script src="/static/${opts.script || "app.js"}"></script></body></html>`;
}

function errorPage(res, status, msg) {
  send(res, status, page(APP, `<main><h1>${esc(APP)}</h1><p class="error">${esc(msg)}</p><p><a href="/">Back to projects</a></p></main>`));
}

// A request that changes something must come from this host's own pages.
// A form POST and a WebSocket both carry Origin. This stops another site, or
// another app on the same box, from acting with the user's login cookie.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      body += c;
      if (body.length > 16384) reject(new Error("form too large"));
    });
    req.on("end", () => resolve(new URLSearchParams(body)));
    req.on("error", reject);
  });
}

// Running tmux sessions, as folder path -> true.
function runningSessions() {
  const r = spawnSync("tmux", [...TMUX, "list-sessions", "-F", "#{session_name}\t#{@moose_folder}"], { encoding: "utf8" });
  const out = new Map();
  if (r.status !== 0) return out;
  for (const line of r.stdout.split("\n")) {
    const [name, rel] = line.split("\t");
    if (name && rel && sessionName(rel) === name) out.set(rel, true);
  }
  return out;
}

function ago(ms) {
  if (!ms) return "never";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => !d.name.startsWith(".") && (d.isDirectory() || d.isSymbolicLink()))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// --- pages -----------------------------------------------------------------

function row(rel, label, recent, running) {
  const on = running.has(rel);
  const stop = on
    ? `<form method="post" action="/stop" data-confirm="Stop the session in ${esc(label)}? Anything running in it ends.">
<input type="hidden" name="folder" value="${esc(rel)}"><button class="small">Stop</button></form>`
    : "";
  return `<li><a href="${esc(folderUrl(rel))}"><span class="dot ${on ? "on" : ""}" title="${on ? "Session running" : "No session"}"></span>
<span class="name">${esc(label)}</span><span class="when">${esc(ago(recent[rel]))}</span></a>${stop}</li>`;
}

function projectPage(res) {
  const recent = readRecent();
  const running = runningSessions();
  const byRecent = (a, b) => (recent[b.rel] || 0) - (recent[a.rel] || 0) || a.label.localeCompare(b.label);
  const shown = new Set();
  let body = `<main><h1>${esc(APP)}</h1>`;

  const projects = resolveFolder("projects");
  if (projects) {
    const rows = subdirs(PROJECTS).map((n) => resolveFolder(`projects/${n}`) && { rel: `projects/${n}`, label: n })
      .filter(Boolean).sort(byRecent);
    rows.forEach((r) => shown.add(r.rel));
    body += `<section><h2>Projects</h2>
<ul class="rows">${rows.map((r) => row(r.rel, r.label, recent, running)).join("") || `<li class="empty">No projects yet.</li>`}</ul>
<div class="actions">
<form method="post" action="/folders"><input type="hidden" name="in" value="projects">
<input name="name" placeholder="New folder name" required pattern="[^/.][^/]*" aria-label="New folder name"><button>New folder</button></form>
<form method="post" action="/clone"><input type="hidden" name="into" value="projects">
<input name="repo" placeholder="https://github.com/owner/repo" required aria-label="Repository to clone"><button>Clone</button></form>
</div><p class="hint">A private repo needs a GitHub login first: open any folder and run <code>gh auth login</code>.</p></section>`;
  }

  const extras = subdirs(EXTRA).map((n) => resolveFolder(`extra/${n}`) && { rel: `extra/${n}`, label: n })
    .filter(Boolean).sort(byRecent);
  extras.forEach((r) => shown.add(r.rel));
  if (extras.length) {
    body += `<section><h2>Other folders</h2><ul class="rows">${extras.map((r) => row(r.rel, r.label, recent, running)).join("")}</ul></section>`;
  }

  // Sessions opened deeper than one level (a link to /p/projects/app/web) still show, so none runs unseen.
  const other = [...running.keys()].filter((rel) => !shown.has(rel)).sort();
  if (other.length) {
    body += `<section><h2>Other running sessions</h2><ul class="rows">${other.map((rel) => row(rel, rel, recent, running)).join("")}</ul></section>`;
  }

  if (!projects && !extras.length) {
    body += `<p class="empty">This app has no folders yet. Choose them on the app's page in moose.</p>`;
  }
  send(res, 200, page(APP, body + "</main>"));
}

function terminalPage(res, folder) {
  const label = folder.rel.replace(/^projects\//, "").replace(/^extra\//, "");
  const src = `/tty/?arg=${encodeURIComponent(folder.rel)}`;
  const keys = [["esc", "Esc"], ["ctrl", "Ctrl"], ["tab", "Tab"], ["left", "←"], ["up", "↑"], ["down", "↓"], ["right", "→"]]
    .map(([k, l]) => `<button type="button" data-key="${k}">${l}</button>`).join("");
  send(res, 200, page(`${label} · ${APP}`, `<header><a href="/">← Projects</a><span class="folder">${esc(label)}</span></header>
<iframe id="term" src="${esc(src)}" title="Terminal"></iframe><nav id="keys" aria-label="Extra keys">${keys}</nav>`,
  { cls: "terminal", script: "term.js" }));
}

function clonePage(res, repo, into) {
  send(res, 200, page(APP, `<main><h1>Clone a repository</h1>
<form method="post" action="/clone" class="stack">
<label>Repository <input name="repo" value="${esc(repo)}" required></label>
<label>Into <input name="into" value="${esc(into || "projects")}" required></label>
<button>Clone</button></form><p><a href="/">Back to projects</a></p></main>`));
}

// https://host/path, ssh://..., or the scp form git@host:path. Never a local path or
// a git transport helper (ext::), and never a leading dash that git would read as an option.
const REPO = /^(https:\/\/[^\s]+|ssh:\/\/[^\s]+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+)$/;
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._ -]*$/;

function cloneRepo(res, repo, intoRel) {
  const into = resolveFolder(intoRel);
  if (!into) return errorPage(res, 400, "That folder cannot be used.");
  if (!REPO.test(repo)) return errorPage(res, 400, "That is not a repository address this page can clone. Use an https:// address.");
  const name = repo.replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop();
  if (!NAME.test(name)) return errorPage(res, 400, "The repository's name cannot be used as a folder name.");
  const dest = path.join(into.dir, name);
  if (fs.existsSync(dest)) return errorPage(res, 409, `A folder named ${name} is already there.`);
  // The credential helper uses the user's own `gh auth login`, when there is one.
  // No prompts: there is no terminal here to answer them.
  execFile("git", ["-c", "credential.helper=!gh auth git-credential", "clone", "--", repo, dest], {
    timeout: 15 * 60 * 1000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new" },
  }, (err, _out, stderr) => {
    if (err) {
      fs.rmSync(dest, { recursive: true, force: true });
      return errorPage(res, 502, `The clone failed: ${String(stderr).trim().split("\n").slice(-3).join(" ")}`);
    }
    redirect(res, folderUrl(`${into.rel}/${name}`));
  });
}

function newFolder(res, inRel, name) {
  const parent = resolveFolder(inRel);
  if (!parent) return errorPage(res, 400, "That folder cannot be used.");
  if (!NAME.test(name) || name.length > 255) return errorPage(res, 400, "Use a name without / and that does not start with a dot.");
  const dest = path.join(parent.dir, name);
  try {
    fs.mkdirSync(dest);
  } catch (e) {
    return errorPage(res, 409, e.code === "EEXIST" ? `A folder named ${name} is already there.` : `The folder could not be made: ${e.message}`);
  }
  redirect(res, folderUrl(`${parent.rel}/${name}`));
}

function stopSession(res, rel) {
  // A folder that is gone can still have a session, so this takes the name as written.
  spawnSync("tmux", [...TMUX, "kill-session", "-t", `=${sessionName(rel)}`], { stdio: "ignore" });
  redirect(res, "/");
}

const TYPES = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

function staticFile(res, name) {
  if (!/^[a-z]+\.(css|js)$/.test(name)) return errorPage(res, 404, "Not found.");
  fs.readFile(path.join(STATIC, name), (err, data) => {
    if (err) return errorPage(res, 404, "Not found.");
    send(res, 200, data, TYPES[path.extname(name)], { "Cache-Control": "no-cache" });
  });
}

// --- proxy to ttyd ---------------------------------------------------------

function proxyHttp(req, res) {
  const up = http.request({ socketPath: SOCK, path: req.url, method: req.method, headers: req.headers }, (r) => {
    // The terminal is framed only by our own terminal page.
    res.writeHead(r.statusCode, { ...r.headers, "x-frame-options": "SAMEORIGIN" });
    r.pipe(res);
  });
  up.on("error", () => errorPage(res, 502, "The terminal is not running."));
  req.pipe(up);
}

function proxyUpgrade(req, socket, head) {
  const refuse = (code, text) => {
    socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/tty/ws") return refuse(404, "Not Found");
  if (!sameOrigin(req)) return refuse(403, "Forbidden");
  const args = url.searchParams.getAll("arg");
  if (args.length !== 1 || !resolveFolder(args[0])) return refuse(403, "Forbidden");
  const up = net.connect(SOCK, () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    up.write(raw + "\r\n");
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
}

// --- routes ----------------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  try {
    if (p === "/tty" || p.startsWith("/tty/")) return proxyHttp(req, res);
    if (req.method === "GET" || req.method === "HEAD") {
      if (p === "/") return projectPage(res);
      if (p === "/favicon.ico") return send(res, 204, "");
      if (p.startsWith("/static/")) return staticFile(res, p.slice(8));
      if (p.startsWith("/p/")) {
        let rel;
        try {
          rel = p.slice(3).split("/").map(decodeURIComponent).join("/");
        } catch {
          return errorPage(res, 400, "That folder address is not valid.");
        }
        const folder = resolveFolder(rel);
        if (!folder) return errorPage(res, 404, "That folder is not one this app can open.");
        return terminalPage(res, folder);
      }
      // A GET only shows the form: cloning needs a POST from this page, so a link on another site cannot start one.
      if (p === "/clone") return clonePage(res, url.searchParams.get("repo") || "", url.searchParams.get("into") || "");
      return errorPage(res, 404, "Not found.");
    }
    if (req.method === "POST") {
      if (!sameOrigin(req)) return errorPage(res, 403, "This request did not come from this app's own page.");
      const form = await readForm(req);
      if (p === "/clone") return cloneRepo(res, form.get("repo") || "", form.get("into") || "");
      if (p === "/folders") return newFolder(res, form.get("in") || "", form.get("name") || "");
      if (p === "/stop") return stopSession(res, form.get("folder") || "");
    }
    return errorPage(res, 404, "Not found.");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) errorPage(res, 500, "Something went wrong.");
  }
}

// Answer only once ttyd is listening, so "the port answers" means the terminal works.
function listenWhenReady(tries = 0) {
  if (fs.existsSync(SOCK)) {
    const server = http.createServer(handle);
    server.on("upgrade", proxyUpgrade);
    server.listen(PORT, () => console.log(`moose-terminal listening on :${PORT}`));
    return;
  }
  if (tries > 100) {
    console.error("ttyd did not start");
    process.exit(1);
  }
  setTimeout(() => listenWhenReady(tries + 1), 100);
}
listenWhenReady();
