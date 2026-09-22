#!/usr/bin/env python3
"""Build one image from images/<name>/upstream.yml, probe it, and optionally push it.

    python3 tools/build.py <name>                  # build + probe, load into the local docker
    python3 tools/build.py <name> --push           # build + probe, then push with SBOM and provenance
    python3 tools/build.py <name> --push --if-exists skip
    python3 tools/build.py <name> --check-tag      # also fail if the tag is already published

The probe is the moose sandbox: --cap-drop ALL and no-new-privileges, once as root
and once as a non-root uid, plus a scan for file capabilities. An image that fails
it is never pushed. See README.md for the upstream.yml format.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY = "ghcr.io/onmoose"
SOURCE_REPO = "https://github.com/onmoose/app-images"
NONROOT = "10001:10001"
REQUIRED = ("repo", "ref_type", "ref", "commit", "revision", "license")


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def run(cmd, **kw):
    print("+ " + " ".join(cmd), flush=True)
    return subprocess.run(cmd, check=True, **kw)


def load(name):
    path = os.path.join(ROOT, "images", name, "upstream.yml")
    if not os.path.isfile(path):
        die(f"{path} not found")
    with open(path) as f:
        spec = yaml.safe_load(f)
    missing = [k for k in REQUIRED if k not in spec]
    if missing:
        die(f"{path}: missing {', '.join(missing)}")
    if spec["ref_type"] not in ("branch", "tag"):
        die(f"{path}: ref_type must be branch or tag")
    if not re.fullmatch(r"[0-9a-f]{40}", str(spec["commit"])):
        die(f"{path}: commit must be a full 40-character SHA")
    if not isinstance(spec["revision"], int) or spec["revision"] < 1:
        die(f"{path}: revision must be a whole number from 1")
    if "dockerfile" not in spec and not os.path.isfile(os.path.join(ROOT, "images", name, "Dockerfile")):
        die(f"{path}: no dockerfile: field and no Dockerfile in the folder")
    return spec


def image_tag(spec):
    version = spec["ref"] if spec["ref_type"] == "tag" else f"git-{spec['commit'][:7]}"
    return f"{version}-moose.{spec['revision']}"


def fetch(spec, dest):
    """Fetch exactly the pinned commit, nothing else."""
    run(["git", "init", "-q", dest])
    run(["git", "-C", dest, "fetch", "-q", "--depth", "1", f"https://github.com/{spec['repo']}.git", spec["commit"]])
    run(["git", "-C", dest, "checkout", "-q", "FETCH_HEAD"])


def build_args(name, spec, src, ref, cache, push):
    folder = os.path.join(ROOT, "images", name)
    dockerfile = os.path.join(src, spec["dockerfile"]) if "dockerfile" in spec else os.path.join(folder, "Dockerfile")
    context = os.path.join(src, spec.get("context", "."))
    # The build context is upstream's source; our own files (an nginx.conf) come in as `packaging`.
    cmd = ["docker", "buildx", "build", "--platform", "linux/amd64", "-f", dockerfile, "-t", ref,
           "--build-context", f"packaging={folder}"]
    labels = {
        "org.opencontainers.image.source": SOURCE_REPO,
        "org.opencontainers.image.version": image_tag(spec),
        "org.opencontainers.image.revision": spec["commit"],
        "org.opencontainers.image.licenses": spec["license"],
        "org.opencontainers.image.description": f"Built by moose from github.com/{spec['repo']} at {spec['commit'][:7]}",
        "io.onmoose.upstream.repo": f"https://github.com/{spec['repo']}",
        "io.onmoose.upstream.commit": spec["commit"],
    }
    for k, v in labels.items():
        cmd += ["--label", f"{k}={v}"]
    for k, v in (spec.get("build_args") or {}).items():
        cmd += ["--build-arg", f"{k}={v}"]
    if cache == "gha":
        cmd += ["--cache-from", f"type=gha,scope={name}", "--cache-to", f"type=gha,mode=max,scope={name}"]
    if push:
        cmd += ["--push", "--sbom=true", "--provenance=mode=max"]
    else:
        cmd += ["--load"]
    return cmd + [context]


def tag_exists(ref):
    return subprocess.run(["docker", "buildx", "imagetools", "inspect", ref],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def file_caps(ref):
    """Files carrying file capabilities. Under cap_drop: ALL the kernel refuses to exec them."""
    cid = subprocess.run(["docker", "create", ref], check=True, capture_output=True, text=True).stdout.strip()
    try:
        proc = subprocess.Popen(["docker", "export", cid], stdout=subprocess.PIPE)
        found = []
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tar:
            for member in tar:
                if "SCHILY.xattr.security.capability" in member.pax_headers:
                    found.append("/" + member.name)
        proc.wait()
        return found
    finally:
        subprocess.run(["docker", "rm", "-f", cid], stdout=subprocess.DEVNULL)


def probe_one(ref, probe, identity):
    uid = "0" if identity == "root" else NONROOT.split(":")[0]
    user = "0:0" if identity == "root" else NONROOT
    name = f"probe-{os.getpid()}-{identity}"
    cmd = ["docker", "run", "-d", "--name", name, "--cap-drop", "ALL",
           "--security-opt", "no-new-privileges:true", "--user", user]
    for k, v in (probe.get("env") or {}).items():
        cmd += ["-e", f"{k}={v}"]
    for path in probe.get("tmpfs") or []:
        cmd += ["--tmpfs", f"{path}:mode=1777"]
    # moose creates every data bind and chowns it to the runtime identity; a tmpfs owned by that uid stands in for it.
    for path in probe.get("data") or []:
        cmd += ["--tmpfs", f"{path}:uid={uid},gid={uid},mode=0755"]
    port = probe.get("port")
    if port:
        cmd += ["-p", f"127.0.0.1::{port}"]
    run(cmd + [ref], stdout=subprocess.DEVNULL)
    try:
        start = time.time()
        deadline = start + probe.get("timeout", 60)
        url = None
        while time.time() < deadline:
            state = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", name],
                                   capture_output=True, text=True).stdout.strip()
            if state != "true":
                return False, "container exited"
            if not port:
                # Nothing to ask, so "still up after settle seconds" is the pass.
                if time.time() - start >= probe.get("settle", 15):
                    return True, "still running"
            else:
                if url is None:
                    host = subprocess.run(["docker", "port", name, str(port)], capture_output=True, text=True).stdout.split()
                    url = f"http://{host[0]}{probe.get('path', '/')}" if host else None
                if url:
                    try:
                        with urllib.request.urlopen(url, timeout=3) as r:
                            return True, f"HTTP {r.status}"
                    except urllib.error.HTTPError as e:
                        if e.code < 500:
                            return True, f"HTTP {e.code}"
                    except (urllib.error.URLError, ConnectionError, TimeoutError):
                        pass
            time.sleep(2)
        return False, "timed out waiting for the app to answer"
    finally:
        logs = subprocess.run(["docker", "logs", "--tail", "30", name], capture_output=True, text=True)
        print(f"--- last log lines as {identity} ---\n{logs.stdout}{logs.stderr}".rstrip(), flush=True)
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def probe(ref, spec):
    p = spec.get("probe") or {}
    ok = True
    # A capped file only breaks the container when it is exec'd. The one we know is exec'd
    # is the entrypoint/command binary; others are listed, and the run probes below catch
    # any capped helper the app runs while it boots.
    caps = file_caps(ref)
    cfg = json.loads(subprocess.run(["docker", "image", "inspect", "-f", "{{json .Config}}", ref],
                                    check=True, capture_output=True, text=True).stdout)
    argv = (cfg.get("Entrypoint") or []) + (cfg.get("Cmd") or [])
    start = argv[0] if argv else ""
    fatal = [c for c in caps if c == start or os.path.basename(c) == start]
    if fatal:
        print(f"FAIL the start binary has file capabilities (won't exec under cap_drop: ALL): {', '.join(fatal)}")
        ok = False
    else:
        print("ok   start binary has no file capabilities")
    for c in caps:
        if c not in fatal:
            print(f"info file capabilities on {c} (fails if the app execs it)")
    must = p.get("as", ["root", "nonroot"])
    for identity in ("root", "nonroot"):
        passed, why = probe_one(ref, p, identity)
        mark = "ok  " if passed else ("FAIL" if identity in must else "info")
        print(f"{mark} as {identity}: {why}")
        if not passed and identity in must:
            ok = False
    return ok


def summary(lines):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as f:
            f.write("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--push", action="store_true")
    ap.add_argument("--if-exists", choices=("fail", "skip"), default="fail")
    ap.add_argument("--check-tag", action="store_true", help="apply --if-exists without pushing")
    ap.add_argument("--cache", choices=("none", "gha"), default="none")
    args = ap.parse_args()

    spec = load(args.name)
    tag = image_tag(spec)
    remote = f"{REGISTRY}/{args.name}:{tag}"
    print(f"{args.name}: {spec['repo']}@{spec['commit'][:7]} -> {remote}")

    # A published tag is never overwritten: the catalog pins digests, and a rebuild is a new revision.
    # --check-tag applies the same rule on a pull request, before anything is pushed.
    if (args.push or args.check_tag) and tag_exists(remote):
        if args.if_exists == "fail":
            die(f"{remote} already exists. Bump revision: in upstream.yml to publish a rebuild.")
        if args.push:
            print(f"{remote} already exists, skipping")
            return

    work = tempfile.mkdtemp(prefix=f"app-images-{args.name}-")
    try:
        src = os.path.join(work, "src")
        fetch(spec, src)
        # Timestamps come from the upstream commit, so the probed build and the pushed build match.
        os.environ["SOURCE_DATE_EPOCH"] = subprocess.run(
            ["git", "-C", src, "log", "-1", "--format=%ct"], check=True, capture_output=True, text=True).stdout.strip()
        local = f"app-images/{args.name}:probe"
        run(build_args(args.name, spec, src, local, args.cache, push=False))
        if not probe(local, spec):
            summary([f"### {args.name}: probe FAILED", "", "Not pushed."])
            die("probe failed, not pushing")
        if not args.push:
            summary([f"### {args.name}: built and probed", "", f"Would publish `{remote}`."])
            return
        meta = os.path.join(work, "meta.json")
        run(build_args(args.name, spec, src, remote, args.cache, push=True) + ["--metadata-file", meta])
        with open(meta) as f:
            digest = json.load(f)["containerimage.digest"]
        print(f"pushed {remote}@{digest}")
        summary([f"### {args.name}: published", "", f"`{remote}@{digest}`"])
        out = os.environ.get("GITHUB_OUTPUT")
        if out:
            with open(out, "a") as f:
                f.write(f"ref={REGISTRY}/{args.name}@{digest}\n")
    finally:
        shutil.rmtree(work, ignore_errors=True)
        subprocess.run(["docker", "image", "rm", f"app-images/{args.name}:probe"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
