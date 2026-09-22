#!/usr/bin/env python3
"""Print the CI build matrix as JSON: which images to build, and what to do if the tag exists.

    python3 tools/plan.py <base-sha> <head-sha>   # a pull request or a push
    python3 tools/plan.py --all                   # a manual run over every image
    python3 tools/plan.py --only <name>           # a manual run over one image

An image whose own folder changed must produce a new tag ("fail" if it exists): a
changed folder with the same tag would publish different bytes under an old name.
A change to tools/ or the workflow rebuilds every image to test it, and "skip"s
tags that already exist, since nothing about those images changed.
"""

import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def all_images():
    d = os.path.join(ROOT, "images")
    return sorted(n for n in os.listdir(d) if os.path.isfile(os.path.join(d, n, "upstream.yml")))


def main():
    args = sys.argv[1:]
    if args == ["--all"]:
        plan = [{"image": n, "if_exists": "skip"} for n in all_images()]
    elif len(args) == 2 and args[0] == "--only":
        if args[1] not in all_images():
            sys.exit(f"no image folder named {args[1]}")
        plan = [{"image": args[1], "if_exists": "skip"}]
    elif len(args) == 2:
        base, head = args
        if set(base) == {"0"}:  # the first push to a branch has no "before"
            plan = [{"image": n, "if_exists": "skip"} for n in all_images()]
        else:
            changed = subprocess.run(["git", "-C", ROOT, "diff", "--name-only", f"{base}...{head}"],
                                     check=True, capture_output=True, text=True).stdout.split()
            folders = {p.split("/")[1] for p in changed if p.startswith("images/") and p.count("/") >= 2}
            touched_tools = any(p.startswith("tools/") or p.startswith(".github/workflows/") for p in changed)
            plan = []
            for n in all_images():
                if n in folders:
                    plan.append({"image": n, "if_exists": "fail"})
                elif touched_tools:
                    plan.append({"image": n, "if_exists": "skip"})
    else:
        sys.exit(__doc__)
    print(json.dumps(plan))


if __name__ == "__main__":
    main()
