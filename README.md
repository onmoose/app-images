# app-images

Container images that [moose](https://github.com/onmoose/os) builds for apps whose upstream publishes none.

moose installs apps from prebuilt images. Some good apps never publish one: their docs say "clone and run `pnpm dev`", or their compose only has `build:`. For those, this repo builds the image from upstream's own source and publishes it to `ghcr.io/onmoose/<image>`.

This repo holds **packaging only**. It never changes an app's code. A fix to the app goes upstream as a pull request. When upstream starts publishing its own image, we switch to theirs and delete the folder here.

## How it works

One folder per image under `images/`. A folder points at the upstream repo at a pinned commit. There are no forks: the build fetches exactly that commit and builds it.

```
images/<image>/
  upstream.yml   # where the source comes from, and how to probe the result
  Dockerfile     # ours, only when upstream has none
  ...            # any file our Dockerfile needs (it sees this folder as the `packaging` context)
```

Every build runs a **probe** before anything is published. The probe runs the image the way moose runs every app: `--cap-drop ALL` and `no-new-privileges`, once as root and once as uid 10001, and waits for the app to answer. It also fails an image whose start binary carries file capabilities, since the kernel refuses to run those under `cap_drop: ALL`. An image that fails the probe is never pushed.

Published images carry an SBOM (a list of what is inside), build provenance, and a cosign signature made with this workflow's own GitHub identity. To check one:

```bash
cosign verify ghcr.io/onmoose/<image>@<digest> \
  --certificate-identity-regexp '^https://github.com/onmoose/app-images/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## upstream.yml

```yaml
repo: CopilotKit/OpenMuse        # GitHub owner/name
ref_type: branch                 # branch or tag: what we follow
ref: main                        # the branch or tag name
commit: fed01e9d...              # the full commit SHA we build (Renovate keeps it current)
revision: 1                      # our rebuild counter for the same source; bump it to republish
license: MIT                     # upstream's license
context: apps/worker             # optional: build context inside upstream's repo (default: the root)
dockerfile: apps/worker/Dockerfile   # optional: upstream's Dockerfile; omit to use the one in this folder
build_args: {}                   # optional
probe:
  port: 8790                     # the port the app listens on; omit for an app with no HTTP port
  path: /health                  # any answer below 500 passes
  env: {}                        # throwaway values the app needs to start. Never a real secret.
  tmpfs: [/tmp]                  # scratch dirs moose's compose will mount as tmpfs
  data: [/data]                  # data dirs moose will bind and chown to the runtime identity
  as: [root, nonroot]            # which identities must pass (default: both)
  timeout: 60
  services:                      # optional: companion containers the app needs to boot (a database, ...)
    - name: database               # reachable from the app container as this hostname
      image: postgres:17.6@sha256:...   # pinned by tag and digest, same as any other image
      env: { POSTGRES_PASSWORD: probe-only-pw }   # throwaway values, never a real secret
      ready:                        # optional: how to tell the companion is up
        cmd: ["pg_isready", "-U", "postgres"]   # run with `docker exec` until it exits 0
        timeout: 30                              # seconds to wait for cmd (or, with no cmd, a fixed sleep)
```

`probe.services` starts each companion on its own docker network before the app container, and attaches the app container to that same network, so it can reach a companion by the `name` given. Companions are plain helpers: only the app container under test runs with `--cap-drop ALL`, `no-new-privileges`, and both identities. Everything (companions and their network) is removed after the probe, pass or fail.

Keep `repo`, `ref_type`, `ref` and `commit` as the first four keys, in that order. Renovate finds them by that pattern.

**The tag** is `<ref>-moose.<revision>` when following a tag, and `git-<short sha>-moose.<revision>` when following a branch. A published tag is never overwritten. If a folder changes and its tag already exists, CI fails until `revision` is bumped.

## Build one locally

Needs Docker with buildx and Python with PyYAML.

```bash
python3 tools/build.py openmuse-server     # fetch, build, probe; nothing is pushed
```

## Adding an image

1. Add `images/<image>/upstream.yml`, plus a `Dockerfile` if upstream has none.
2. Run `tools/build.py` locally until the probe passes.
3. Open a pull request. CI builds and probes it again.
4. Merge. CI publishes `ghcr.io/onmoose/<image>:<tag>`. A package this public repo's workflow creates comes out public, since the image's `org.opencontainers.image.source` label links it here. Check once that an anonymous pull works: a box pulls without logging in.

## Keeping current

Renovate opens one pull request per upstream each week. It moves the pinned commit when the followed branch moves or the followed tag gets a new release, and it moves the base images in our Dockerfiles in the same pull request. A base image change alone keeps the tag the same, so CI fails until someone bumps `revision:` on that pull request. Merging it publishes the new image. The catalog then picks up the new digest in its own version bump.
