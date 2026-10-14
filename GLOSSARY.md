# XClipper

XClipper exports X posts, threads, and articles. These terms distinguish what a user exports, where it comes from, and how a batch acquires it.

## Language

**Export mode**:
Single or Batch: export one post (with its thread or article when applicable), or many posts in one run.
_Avoid_: Engine, fetch mode

**Batch engine**:
Manual, Auto, or Super: the user's choice of how a batch acquires posts and expands their content.
_Avoid_: Batch mode, fast mode

**Manual**:
The default batch engine, exporting posts loaded by scrolling a source or chosen through Selection, with full threads and articles. It supports pause, resume, and stop.
_Avoid_: Standard, standard batch

**Auto**:
The optional batch engine that fetches a source feed automatically and expands full threads and articles.
_Avoid_: Fast Batch, auto extract

**Super**:
The optional batch engine that fetches a source feed automatically while skipping self-thread expansion for greater volume. Articles and replies to other authors are still expanded; fetched replies can include the author's follow-up posts.
_Avoid_: Super Fast, root-only engine

**Source**:
The collection a batch exports: Bookmarks, Profile, Likes, Timeline, or Selection. Timeline and Selection use Manual; the other sources support all three engines.
_Avoid_: Engine, export mode

**Fetch mode**:
Recent, Resume, or Date range: how Auto or Super traverses a source feed. Recent starts at the top; Resume continues a backfill; Date range finds posts published in a chosen window with its own continuation position.
_Avoid_: Engine, pagination mode

**Acquisition path**:
The way post content is obtained: DOM acquisition for Manual and single exports, or GraphQL acquisition for Auto and Super.
_Avoid_: Engine (when referring to the two acquisition paths)

**Automatic single-post trigger**:
An inline action, context menu action, or URL marker that starts a single export without the popup's export button.
_Avoid_: Auto engine, Auto batch
