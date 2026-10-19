# Context Bank Show Research + Focused Scene Search Implementation Plan

**Status:** Approved architecture continuation. Execute RED/GREEN on `feature/anime-review-update-02` using the Windows GitHub Actions gate.

**Goal:** Let an anime-review project start from only the show title, build a durable and source-backed research map once, and use that map to narrow future source-footage searches without scanning or deeply analysing every imported episode.

**Design principle:** Research says where to look. Imported footage proves what is there. Verified source observations always outrank research priors.

## Architecture decisions locked by this plan

1. **Do not create a Context Bank for an unsaved project.** The detailed bank stays beside the `.lumen` file. No fallback to AppData/C: is allowed.
2. **Keep only lightweight user intent/configuration in the project document.** `Project.animeReview` stores the typed show query and, once confirmed, a compact selected identity. Web pages, research chunks, claims, confidence and provenance remain bank-only.
3. **Anime-review creation establishes a durable project path before research.** When a show title is supplied, creation immediately asks for the `.lumen` location. If Save As is cancelled, the project may remain open unsaved but research stays `pending-save` and makes no bank writes.
4. **No hidden paid LLM research run at project creation.** Initial research uses a structured anime catalogue lookup plus Lumen's existing bounded web search/read integration. This stage is network work but not a paid model call.
5. **Use AniList only as the first identity resolver adapter, not as the truth layer for episode events.** Its public GraphQL API provides stable anime identity/title/format/year/episode/character metadata. The resolver is behind a small adapter so it can be replaced/fallback later. Research claims still need source provenance.
6. **Do not pre-summarize an entire show with an LLM.** Cache a small research pack once, split it into indexed chunks, and retrieve only chunks relevant to the active narration/editing question. The AI may then persist a compact prior for reuse.
7. **Research evidence and verified media evidence are different data types/tables.** A web-backed prior can say “episode 2, probably early”; only an actual imported-media observation can say “asset X 133.4–147.8 s contains this scene.”
8. **Never invent exact timestamps from web research.** `early` / `middle` / `late` may be translated into a derived search window for planning, but the result is explicitly marked derived/unverified.
9. **Focused scene planning is not media analysis.** This phase ranks where a later analyser should look. It must not call vision, transcription, frame extraction, or web research merely because episodes were imported.
10. **Negative source evidence is useful.** Existing `search-miss` source observations should prevent the planner from repeatedly proposing an already-inspected irrelevant window.
11. **All AI-facing reads are bounded.** No raw SQL, unrestricted research dump, bank clear, fingerprint mutation, or automatic whole-episode scan is exposed to the model.

---

## Task 0: Re-establish the verified baseline

**Files:** none.

Run the current branch workflow and record the starting head.

Expected baseline from the preceding milestone:
- 64 test files / 381 tests passing.
- `npm run typecheck` passing for app and node targets.
- ordinary 12-episode import performs zero semantic-analysis/transcription writes.

Do not begin production changes if this baseline has regressed.

---

## Task 1: Add lightweight anime-review project setup intent

**Files:**
- Modify: `Lumen-Fixed/src/editor/types.ts`
- Modify: `Lumen-Fixed/src/editor/new-project.ts`
- Modify: `Lumen-Fixed/src/editor/store.ts`
- Modify: `Lumen-Fixed/src/project/session.ts`
- Modify: `Lumen-Fixed/src/features/home/HomeScreen.tsx`
- Create/modify focused tests under `src/editor`, `src/project`, and `src/features/home` as appropriate.

### Contract

Add an optional versioned project field similar to:

```ts
interface AnimeReviewSetup {
  version: 1
  showQuery: string
  identity?: {
    source: 'anilist'
    externalId: string
    canonicalTitle: string
    year?: number
    format?: string
    episodes?: number
  }
}
```

The exact field names may be adjusted to fit repo conventions, but it must remain compact and contain no fetched pages, claim arrays, source excerpts, or research cache.

### RED tests

Prove:
- `createEmptyProject` can create a normal project with no anime metadata.
- an anime-review project preserves a trimmed show query through project serialization/migration.
- older projects migrate with no new required fields.
- invalid/empty show setup is ignored or rejected deterministically rather than partially persisted.
- generic dropped-media/new-project behavior remains unchanged when no show title is supplied.

### GREEN implementation

Home/new-project behavior:
- add a compact show-title input for the Anime Review workflow;
- user still chooses normal canvas/fps;
- creating with a show title creates the project and immediately invokes Save As so the project gets a durable folder;
- if Save As succeeds, return enough state for research initialization;
- if Save As is cancelled, keep the project usable but do not research/write a bank.

Do not start network work from `createEmptyProject` or editor-store code.

### Verification

Focused tests, then full `npm test` + `npm run typecheck` on Windows CI.

---

## Task 2: Define show-research contracts and strict evidence types

**Files:**
- Create: `Lumen-Fixed/shared/context-bank-research.ts`
- Create: `Lumen-Fixed/shared/context-bank-research.test.ts`
- Modify: `Lumen-Fixed/shared/context-bank.ts`
- Modify: `Lumen-Fixed/shared/app.ts`
- Modify: `Lumen-Fixed/electron/preload.ts`

### Contracts

Define bounded types for:
- research status: `not-started | resolving | needs-confirmation | seeding | ready | error`;
- identity candidates and selected identity;
- research source metadata;
- research chunks;
- source-backed research priors;
- bounded research search request/result;
- prior write request/result.

A prior must include:
- deterministic id or inputs sufficient to derive one;
- semantic query/claim text;
- optional episode number;
- optional coarse position hint: `early | middle | late | unknown`;
- confidence in `[0,1]`;
- exact research chunk/source evidence reference;
- a short evidence excerpt;
- provenance/created-at/analysis version.

Never include a verified source timestamp field in a research-prior type.

### Validation

Hard-cap:
- source page/chunk text lengths;
- number of seed sources;
- query result count and character budget;
- evidence excerpt length;
- confidence and episode number;
- URLs to public http/https only at the main-process fetch boundary.

RED first, then contract-only GREEN.

---

## Task 3: Migrate the Context Bank to schema v3 for research evidence

**Files:**
- Modify: `Lumen-Fixed/electron/context-bank-core.ts`
- Create: `Lumen-Fixed/electron/context-bank-research.ts`
- Modify: `Lumen-Fixed/electron/context-bank.ts`
- Add focused Context Bank research tests.
- Modify Save As tests.

### Schema v3

Add migrations without rebuilding existing v2 data.

Recommended logical tables:
- `show_research_state` — one current identity/research status record for this project;
- `research_sources` — canonical URL, title/site, retrieved time, content hash, bounded readable text;
- `research_chunks` — deterministic chunk id, source id, ordinal, heading, text, optional explicitly-detected episode number;
- `research_priors` — compact derived prior with query/text, episode number, position hint, confidence, evidence chunk id/excerpt, producer/version/created-at.

Add FTS5 over research chunk heading/text if supported by the bundled Node SQLite build. If FTS5 is unavailable in a test environment, fail the migration clearly rather than silently substituting an unindexed full scan; assess a deterministic indexed fallback before changing architecture.

### Required behavior

- v2 database opens and migrates to v3 with transcripts/observations/timeline state intact;
- source/page upserts are idempotent by normalized URL + content hash;
- chunks are deterministic and replace atomically when a source changes;
- prior writes validate that their referenced chunk exists;
- evidence excerpt must normalize-match text inside the referenced chunk;
- research prior can never be written as `verified-media` provenance;
- Save As copies all research state/sources/chunks/priors;
- clearing the bank clears research cache but not `Project.animeReview` or canonical media/project data.

### Search behavior

`searchResearch` must:
- use tokenized/escaped FTS input rather than exposing raw FTS syntax;
- return bounded snippets, source ids/URLs/titles, optional explicit episode number and relevance score;
- return previously recorded priors separately from raw research chunks;
- prefer a matching persisted prior over repeating raw-source interpretation when both answer the same request.

---

## Task 4: Add structured anime identity resolution with an adapter boundary

**Files:**
- Create: `Lumen-Fixed/shared/anime-catalog.ts`
- Create: `Lumen-Fixed/electron/integrations/anime-catalog.ts`
- Add tests for response shaping/scoring/errors.
- Modify: `Lumen-Fixed/shared/integrations.ts`
- Modify: `Lumen-Fixed/electron/integrations/ipc.ts`
- Modify: `Lumen-Fixed/electron/preload.ts`

### First resolver

Use a small `AnimeCatalogResolver` abstraction. First implementation uses AniList GraphQL through the main process. It should make one bounded public query for candidates and request only identity-level fields needed by Lumen, such as:
- id;
- title variants/synonyms;
- year/season;
- format;
- episode count;
- description/genres if cheap;
- limited character names/roles if useful for the initial index.

No OAuth/user data is required.

### Candidate scoring

Pure tested scorer:
- normalize punctuation/case/whitespace;
- exact match against canonical/English/Romaji/native/synonym titles is strongest;
- year/format are tie-break information, not invented from the user query;
- auto-select only when the best candidate is unambiguously strong;
- otherwise return `needs-confirmation` candidates and do not seed show-specific web pages yet.

Never merge two adaptations or seasons to “be helpful.”

### Failure behavior

- timeout/rate-limit/API error produces retryable research status, not project-creation failure;
- generic Lumen editing remains available offline;
- resolver failure must not fall back to a guessed identity silently.

Before implementation, re-check the current AniList API endpoint/schema against its official docs because this is an external API.

---

## Task 5: Seed a bounded research pack once after the project has a durable path

**Files:**
- Create: `Lumen-Fixed/src/project/anime-research.ts`
- Create focused tests.
- Modify session/save lifecycle only where needed.
- Reuse existing `desktop.integrations.web.search/read` — do not create a second browser/network stack.

### Trigger

After a show-titled project successfully receives its first durable path:
1. flush/reconcile Context Bank so the v3 bank exists;
2. check research status;
3. resolve identity if not already selected;
4. if ambiguity remains, set `needs-confirmation` and stop;
5. if selected, seed research sources once.

On reopen, `ready` research must not refetch pages. `error` or stale/explicit refresh states may retry only through an explicit retry/refresh action.

### Seed budget

Keep initial research deliberately small. Start with a few targeted queries such as:
- canonical show title + overview/characters;
- canonical show title + episode guide;
- canonical show title + episode summaries;
- canonical show title + relevant adaptation/year when needed.

Suggested hard ceiling for first implementation:
- <= 4 web searches;
- <= 8 unique pages read;
- <= 30,000 readable characters retained per page;
- deterministic domain/URL dedupe;
- total retained research text bounded to a few hundred KB, not megabytes.

Do not call an LLM during this seeding step.

### Chunking

Split readable pages by headings/paragraph boundaries into deterministic modest chunks. Detect episode numbers only when text explicitly labels them (`Episode 2`, `Ep. 2`, etc.); never infer episode number from chunk order.

Store source URL/title/site/retrieved time with every chunk lineage.

### Tests

Prove:
- unsaved project => zero web calls and zero bank writes;
- first save => one seed run;
- reopen ready project => zero refetch;
- ambiguity => candidates stored, no detailed seed calls;
- failure is retryable and does not corrupt existing research;
- generic/non-anime project => zero research calls.

---

## Task 6: Add bounded research retrieval and prior-recording tools for the AI

**Files:**
- Create: `Lumen-Fixed/src/integrations/tools/context-bank-research.ts`
- Modify: `Lumen-Fixed/src/integrations/tools/anime-review.ts`
- Add focused tool tests.

Add only the minimum safe tools:

1. `get_show_research_status`
   - current show query/selected identity/status/source counts;
   - no giant text dump.

2. `search_show_research`
   - semantic keyword query supplied by the current editing task;
   - hard item/character limits;
   - returns matching persisted priors first, then research chunks with source provenance;
   - cache-only, no web call.

3. `record_research_prior`
   - persists one compact prior after the AI has interpreted a returned research chunk;
   - must name the exact source chunk and supporting excerpt;
   - bank verifies excerpt membership;
   - deterministic retry/upsert;
   - fixed producer/version;
   - cannot claim verified-media status.

Do **not** expose arbitrary research-source insertion, URL fetching, SQL, clear, identity mutation, or confidence outside `[0,1]` to the model.

Each tool waits for Context Bank synchronization and rechecks project identity, following the reusable-analysis tool pattern already implemented.

---

## Task 7: Build deterministic episode-asset mapping and the focused scene-search planner

**Files:**
- Create: `Lumen-Fixed/src/editor/anime-source-map.ts`
- Create: `Lumen-Fixed/src/editor/anime-scene-search.ts`
- Add focused tests.
- Reuse/refactor tokenization from `anime-footage-matcher.ts` where sensible rather than duplicating incompatible scoring rules.

### Episode asset mapping

Parse explicit filename/name forms with confidence, for example:
- `Episode 02`
- `EP02`
- `E02`
- `S01E02`

Do not interpret arbitrary bare numbers as episode numbers unless the naming pattern is explicit enough. Multiple assets mapping to the same episode remain separate candidates and should surface ambiguity rather than being silently merged.

### Planner inputs

The planner receives:
- semantic query / narration concept;
- current project assets;
- verified source observations from the Context Bank;
- persisted research priors / research search hits;
- optional candidate limit.

### Ranking order

1. **Verified source observation match:** exact source asset/time span; highest authority.
2. **Research prior:** candidate episode and optional coarse position; explicitly unverified.
3. **Existing indexed asset transcript/cue/tag match:** preserve current `anime-footage-matcher` usefulness.
4. **Metadata-only episode candidate:** last resort.

A `search-miss` verified source observation overlapping a proposed window must suppress/down-rank that window.

### Position hints

For a prior with `early|middle|late`, the planner may translate the hint into a derived search window based on source duration, but the returned candidate must carry fields/reasons showing:
- the window is derived;
- research is not verified footage evidence;
- actual media inspection is still required.

For a prior with only an episode number and no position hint, do **not** fabricate a timestamp. Return an episode-level candidate with a strategy like `sample-episode-first`, for the later focused analyser to narrow cheaply.

### Output

Candidates should include:
- asset id;
- source range only when truly known or explicitly derived;
- authority (`verified-source | research-prior | indexed-source | metadata`);
- confidence/score;
- evidence/source ids;
- why it ranked;
- `requiresVerification`.

No timeline mutation and no media analysis occurs in this planner.

---

## Task 8: Expose one bounded scene-search planning tool

**Files:**
- Modify the anime-review tool registry and tests.
- Add a focused planner-tool module if needed.

Add:
`plan_source_scene_search`

It should:
- accept a focused semantic description of the scene/evidence needed;
- wait for bank sync;
- query verified observations and research/index data with hard budgets;
- run the deterministic planner;
- return a small ordered candidate list.

It must **not**:
- fetch the web;
- transcribe an episode;
- request frames;
- invoke a vision model;
- place footage on the timeline;
- scan all imported episode bytes.

This is the handoff point for the next implementation plan: a hierarchical candidate-window verifier that uses cheap scene boundaries/sampled frames first and only performs expensive multimodal analysis on bounded candidate windows.

---

## Task 9: Regression, performance and provenance verification

Add/extend tests proving:
- importing 12 episodes remains semantic-analysis free;
- creating an unsaved anime project creates no Context Bank and no web research side effect;
- first durable save starts at most one bounded seed run;
- old v1/v2 banks migrate safely to v3;
- Save As preserves research state and verified source observations;
- research prior never becomes a verified source observation automatically;
- exact verified source observation outranks contradictory research prior;
- changed media fingerprint invalidates verified source observations but does **not** erase unrelated web research evidence;
- negative source observations prevent repeat candidate windows;
- AI research/query outputs obey budgets;
- no destructive Context Bank capability appears in the AI registry;
- full `npm test` and `npm run typecheck` pass on Windows.

### Manual acceptance gate on the user's PC

Leave this explicitly unpassed until tested in real Electron:
1. create an Anime Review project with a show title;
2. choose a D: project location;
3. confirm Context Bank/research files appear beside that project, not C: AppData;
4. verify identity resolution/ambiguity UX;
5. let the bounded seed finish;
6. close/reopen without refetching;
7. import the full episode set without automatic transcription/vision analysis;
8. ask for a scene and verify the planner starts with research-backed likely episode/range;
9. inspect/verify a source window and ensure the new verified observation outranks the web prior thereafter;
10. Save As and verify the research + source map survives.

## Next plan after this one

Do not bundle the expensive media verifier into this implementation. Once the planner reliably produces bounded candidate windows, audit Lumen's existing `get_media_frames`, scene-boundary, frame sampling and multimodal model paths and write a separate plan for hierarchical candidate verification. That verifier should expand search only when confidence is insufficient and record both hits and misses back into the source-observation layer.
