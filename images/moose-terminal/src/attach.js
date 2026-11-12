// ttyd runs this for each terminal tab, with the folder from the URL as its one
// argument (ttyd -a). It checks the folder again, makes the folder's tmux session
// if it is not running yet, and attaches to it. Two tabs on one folder share it.
"use strict";

const { spawnSync } = require("child_process");
const { resolveFolder, sessionName, markUsed } = require("./lib");

const TMUX = ["-f", "/opt/moose-terminal/tmux.conf"];

const folder = resolveFolder(process.argv[2]);
if (!folder || process.argv.length !== 3) {
  process.stdout.write("This folder cannot be opened. Go back to the projects page and pick a folder.\r\n");
  process.exit(1);
}

const name = sessionName(folder.rel);
const has = spawnSync("tmux", [...TMUX, "has-session", "-t", `=${name}`], { stdio: "ignore" });
if (has.status !== 0) {
  // -d: start it detached, then attach below. A second tab that loses the race
  // gets "duplicate session" here, which is fine: the attach still works.
  spawnSync("tmux", [...TMUX, "new-session", "-d", "-s", name, "-c", folder.dir,
    "-e", `MOOSE_FOLDER=${folder.rel}`, "/opt/moose-terminal/session.sh"], { stdio: "inherit" });
  // The project page reads this back to list running sessions by folder.
  // set-option takes a pane target, so the exact session name needs the ":" after it.
  spawnSync("tmux", [...TMUX, "set-option", "-t", `=${name}:`, "@moose_folder", folder.rel], { stdio: "ignore" });
}
try {
  markUsed(folder.rel);
} catch (e) {
  process.stderr.write(`could not save when ${folder.rel} was used: ${e.message}\n`);
}
const r = spawnSync("tmux", [...TMUX, "attach-session", "-t", `=${name}`], { stdio: "inherit" });
process.exit(r.status ?? 1);
