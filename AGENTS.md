# moose app-images

Container images that moose builds for apps whose upstream publishes none. moose installs every app from a prebuilt image. Some good apps never publish one, so this repo builds the image from upstream's own source and publishes it to `ghcr.io/onmoose/<image>`. The pitch, the `upstream.yml` format and the verify command are in `README.md`. Read it first.

**This repo is public, and so is every image it pushes.** Anyone can read the folders, the build logs and the images. Write every commit, PR, issue and comment so it reads on its own. Name the public `onmoose/os` repo when you need to, but never name a private repo, its issue numbers or its internals. Describe what the image must do, not the private work behind the request.

## What this repo is, and what it is not

- **Packaging only.** We write Dockerfiles, config files like `nginx.conf`, and `upstream.yml`. We never change an app's code. A fix to the app goes upstream as a pull request. An app that needs an ongoing source patch does not belong here.
- **No forks.** A folder points at upstream's repo at a pinned full commit SHA. The build fetches exactly that commit and nothing else (`tools/build.py` `fetch`).
- **We build upstream's release, not a version we pick.** Follow the newest release tag. When upstream has no tags, follow the default branch. The versions inside the app (its runtime, its dependencies) are upstream's call, taken from its lockfiles. An old version is not a finding.
- **Upstream's own image wins.** When upstream starts to publish an image, moose switches to it and the folder here is deleted.

## Layout

```
images/<image>/
  upstream.yml   # where the source comes from, the tag inputs, and how to probe the result
  Dockerfile     # ours, only when upstream has none (else upstream.yml names upstream's)
  ...            # any file our Dockerfile needs; the build sees this folder as the `packaging` context
tools/
  build.py       # fetch, build, probe, and (with --push) publish one image
  plan.py        # print the CI matrix: which images a change rebuilds
.github/workflows/build.yml   # PRs build and probe; a merge to main publishes and signs
renovate.json                 # keeps pinned commits, base images and actions current
```

One image per folder. Several images can share one upstream commit (the three `openmuse-*` images do). Renovate groups those so they move in one PR. Every upstream needs a `packageRules` group in `renovate.json` that matches its folders by path (see the OpenMuse group), with the weekly schedule. The group also pulls in the base images of our Dockerfiles. A base image change alone keeps the tag the same, so its PR fails CI until someone bumps `revision:`. Next to a commit move, the tag changes on its own. When a base image moves in a week where upstream does not, push a `revision:` bump to the Renovate branch.

## Commands

```bash
python3 tools/build.py <image>              # fetch, build, probe; loads into local docker, pushes nothing
python3 tools/build.py <image> --check-tag  # also fail if the tag is already published (what a PR runs)
python3 tools/plan.py <base-sha> <head-sha> # the matrix CI would build for this change
python3 tools/plan.py --all
```

Needs Docker with buildx and Python with PyYAML. Builds are `linux/amd64` only. **Never run `--push` by hand.** Only the `publish` job on `main` publishes, because it also signs the image and records where it came from.

**Run `tools/build.py` on every image you touch, and let the probe pass, before you open a PR.** CI runs the same probe again, but a local run shows the log lines and is faster to fix.

## The rules a change must hold

**A published tag is never overwritten.** The tag is `<ref>-moose.<revision>` for a followed tag, and `git-<short sha>-moose.<revision>` for a followed branch. Boxes pin images by digest, so a changed image under an old tag would lie about what it is. If you change anything in a folder and the upstream commit stays the same, bump `revision:`. CI fails the PR until you do (`plan.py` marks a changed folder `if_exists: fail`). When Renovate moves the commit, the tag changes on its own, so reset nothing.

**The probe is moose's sandbox.** It runs the image with `--cap-drop ALL` and `no-new-privileges`, once as root and once as uid 10001, and fails a start binary that carries file capabilities. An image that fails is never pushed. Do not weaken the probe to get an image through. If the image cannot pass under these rules, it cannot run on a box either. The probe copies how the moose OS runs an app, so a change to that model in `onmoose/os` needs the same change in `tools/build.py`, in the same unit of work.

**`as:` narrows the probe only for a real reason.** Drop `root` from `as:` only when moose runs that app as its own service user, and say why in a comment (see `images/openmuse-web/upstream.yml`).

**Probe `env:` holds throwaway values only.** This repo is public. Use obvious fake values like `probe-only-...`. Never a real key, token or password.

**Keep `repo`, `ref_type`, `ref` and `commit` as the first four keys of `upstream.yml`, in that order.** Renovate finds them with a regex over that exact shape. A reordered file silently stops getting updates.

**Everything is pinned.** Upstream by full commit SHA. Base images in our Dockerfiles by tag and digest (`node:24.21.0-bookworm-slim@sha256:...`). GitHub Actions by commit SHA with the version in a comment. Renovate moves all three. Never add a floating tag or `latest`.

**Upstream code never sees a secret.** The build runs upstream's code in BuildKit `RUN` steps, in the job that holds `packages: write`. Keep it that way: no `--secret`, no secret in `build_args`, no token in the build context. The registry login sits outside BuildKit on purpose (see the comment in `build.yml`).

**Explain every non-default choice in a comment next to it.** The existing folders do this: why a Dockerfile is ours, why the probe runs in live mode, why `EXPO_PUBLIC_API_URL=/`. The next reader has only the folder and upstream's repo, so the comment has to say what upstream does and why we differ.

**Our Dockerfile runs upstream's own build and start commands.** Use upstream's documented commands (`pnpm build:server`, `pnpm start`) and its lockfile (`--frozen-lockfile` or the same for its tool). Leave out the `USER` line unless the app needs one: moose picks the runtime identity and chowns the data dirs to it.

**Keep the docs and the code in step.** `README.md` # upstream.yml documents every key that `tools/build.py` reads. A new key, or a new check in `load()`, updates the README in the same change.

## Adding an image

1. Check that upstream truly publishes no image, and that its license lets us give out binaries. MIT, Apache 2, BSD, GPL and AGPL do. No license means no. For anything else (SSPL, BSL, Commons Clause, source-available), ask the user before you build.
2. Add `images/<image>/upstream.yml`, plus a `Dockerfile` if upstream has none. Start with `revision: 1`. Add a Renovate group for its upstream in `renovate.json` (see # Layout).
3. Run `tools/build.py <image>` until the probe passes as every identity in `as:`.
4. Open the PR. **Opening it is outward-facing, since the repo and the registry are public. Confirm with the user first.**
5. After the merge publishes, check once that an anonymous pull works (`docker logout ghcr.io`, then `docker pull`). A box pulls without logging in.

## How to write

These rules are the same across the moose repos (`onmoose/os` `CLAUDE.md` # Working style is the source). Keep them in step so a person moving between repos reads the same voice.

- **Write everything at CEFR B1 level.** Chat replies, commit messages, PR and issue bodies, docs, and code comments. Short sentences, common words, one idea per sentence. "Use", not "leverage". Exact names stay exact: a file path, a flag, a key, an error string or a version is never simplified.
- **No em dashes.** Anywhere. Use a colon, a comma, or two sentences. This is a forward rule: fix them in text you are already changing, do not sweep old text.
- **No line wrapping in markdown.** One continuous line per paragraph. Viewers reflow, and hard wraps make diffs harder to read.
- **Explain a technical term once, in plain words, the first time it appears.** "an SBOM (a list of what is inside)", then just "SBOM".
- **Issue and PR titles are short and active.** Lead with a verb: "Add the Foo image", "Bump openmuse-web to revision 2".
- **Do not narrate your own process.** Write the finding and its evidence, not the story of how you got there.
- **Skip small issues.** Raise a follow-up only for a real bug, a security risk, or something a user will hit. Guesses and nice-to-haves are noise. Say them in one line, or drop them.

## Working style

- **Project knowledge lives in checked-in files, never in a coding agent's local memory.** Anything worth remembering about this repo (a rule, a gotcha, why a folder looks the way it does) goes in this file, `README.md`, or a comment in the folder it is about.
- **Work on a branch off latest `main`.** `main` is the only long-lived branch. Never commit straight to it. Commit and push only when the user asks.
- **Work in the checked-out folder, not a worktree**, unless the folder has uncommitted work that a checkout would disturb.
- **Push back on tradeoffs; defer to product calls once made.**
