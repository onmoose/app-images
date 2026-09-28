# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# Context: the calibre-web repo at the commit in upstream.yml.
#
# Upstream ships no Dockerfile and no current image. Its README points Docker
# users at the linuxserver.io image, which starts through s6-overlay: that
# needs root to fix up /run before it drops to PUID:PGID, so it cannot start
# under cap_drop: ALL as a non-root uid. This Dockerfile is ours. It follows
# upstream's "Manual installation" wiki page: install requirements.txt with
# pip, then run `python3 cps.py`. No app code is changed.

# Build stage: pip installs everything into a venv. Two packages the
# metadata group pulls in publish no wheel for this Python: faust-cchardet
# (listed in the group) and pyppmd (needed by py7zr). So pip compiles them, which needs a C compiler. The compiler stays in this
# stage and never reaches the runtime image.
FROM python:3.14.7-slim-trixie@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /src
COPY requirements.txt pyproject.toml ./
# requirements.txt is upstream's core set. The optional groups come from
# upstream's own pyproject.toml, so their version ranges stay upstream's:
# - metadata: read titles, authors and covers from uploaded files, and
#   search online metadata sources.
# - comics: read comic book archives (CBZ, CB7).
# - kobo: Kobo e-reader sync.
# Left out: gdrive and gmail (need a Google Cloud project), goodreads (its
# API is closed), ldap and oauth (need an outside identity server).
RUN python3 -c 'import tomllib; g = tomllib.load(open("pyproject.toml", "rb"))["project"]["optional-dependencies"]; print("\n".join(r for n in ("metadata", "comics", "kobo") for r in g[n]))' > extras.txt \
    && pip install --no-cache-dir -r requirements.txt -r extras.txt

# Runtime stage.
FROM python:3.14.7-slim-trixie@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d

# Runtime libraries upstream's README lists:
# - libmagic1: python-magic (a core requirement) loads it to detect file types.
# - imagemagick: Wand loads its library to read and resize covers (EPUB
#   covers, the thumbnail cache). README: "Required for cover extraction".
# - ghostscript: ImageMagick calls it to render the first page of a PDF as
#   its cover. Without it, PDF uploads get a generic cover.
# Left out on purpose (see upstream.yml for why): Calibre's ebook-convert
# (book conversion, several hundred MB), kepubify (Kobo kepub conversion) and
# unrar (CBR comics; Debian ships it only in non-free).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libmagic1 imagemagick ghostscript \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/calibre-web
# Only what the app needs at runtime. The two requirements files feed the
# app's own dependency check on its About page. library/ holds upstream's
# empty sample Calibre library (metadata.db), which a new install can copy
# to start from.
COPY cps.py requirements.txt optional-requirements.txt LICENSE ./
COPY cps ./cps
COPY library ./library

COPY --from=build /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

# CALIBRE_DBPATH: the settings databases (app.db, gdrive.db) live in
# /config, not next to the code. CACHE_DIRECTORY: upstream's default is cps/cache inside the code
# tree, which a non-root uid cannot write, so the cover thumbnail cache goes
# under /config too. HOME: some libraries write to ~, and a moose runtime uid
# has no passwd entry, so point it at the one dir that uid owns.
ENV CALIBRE_DBPATH=/config \
    CACHE_DIRECTORY=/config/cache \
    HOME=/config \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# A USER line so a plain `docker run` starts non-root. moose sets its own
# runtime uid and chowns /config to it, so this only matters outside moose.
# /config is created owned by that uid for the same reason.
RUN mkdir -p /config && chown 10001:10001 /config
USER 10001:10001

EXPOSE 8083
# -o /dev/stdout: send the app log to stdout, where `docker logs` and the
# moose Logs tab see it. Upstream's default is a file in /config.
CMD ["python3", "/app/calibre-web/cps.py", "-o", "/dev/stdout"]
