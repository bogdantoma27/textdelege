export type Env = Cloudflare.Env;

export type ArticleState = "in-force" | "repealed" | "future";

export interface LawRef {
  key: string;
  label: string;
}

export interface RulingSummary {
  key: string;
  label: string;
  court: string;
  date: string;
  outcome: string;
  finds_unconstitutional: boolean;
}

export interface ArticleRuling {
  file: string;
  number: string;
  title: string | null;
  key: string;
  label: string;
  date: string;
  outcome: string;
}

export interface ArticleLine {
  id: string;
  text: string;
  since: string;
  law: string;
}

export interface ArticleVersion {
  from: string;
  until: string | null;
  commit: string;
  path?: string;
  law_commit: string;
  law: LawRef | null;
  kind: string;
  lines: ArticleLine[];
}

export type EventVerb =
  | "entered"
  | "modified"
  | "completed"
  | "repealed"
  | "unconstitutional"
  | "restated";

export interface ArticleEvent {
  date: string;
  verb: EventVerb;
  units: string[];
  law: LawRef | null;
  kind: string;
  from_version: number | null;
  to_version: number;
}

export interface ArticleNeighbour {
  file: string;
  number: string;
  title: string | null;
  state: ArticleState;
}

export interface ArticleObject {
  schema: string;
  act: {
    path: string;
    alias: string | null;
    title: string;
    short: string | null;
    kind: string;
  };
  file: string;
  number: string;
  title: string | null;
  state: ArticleState;
  repealed: { on: string; law: LawRef | null } | null;
  versions: ArticleVersion[];
  events: ArticleEvent[];
  rulings: RulingSummary[];
  prev: ArticleNeighbour | null;
  next: ArticleNeighbour | null;
}

export type FreshnessStatus =
  | "current"
  | "pending-change"
  | "stale"
  | "unverified"
  | "source-unavailable";

export interface Freshness {
  status: FreshnessStatus | null;
  last_verified: string | null;
  check_due: string | null;
  method: string | null;
  newest_change: string | null;
  newest_change_date: string | null;
  change_in_repo: boolean | null;
  official_url: string | null;
}

export interface ActHeading {
  kind: string;
  label: string;
  name: string;
  depth: number;
}

export interface ActArticleEntry {
  file: string;
  number: string;
  title: string | null;
  lead?: string | null;
  state: ArticleState;
  versions: number;
  changes: number;
  first: string | null;
  last_change: string | null;
  heading?: number;
}

export interface TimelineEntry {
  date: string;
  laws: LawRef[];
  articles: number;
}

export interface ActStats {
  changes_per_year: Record<string, number>;
  most_amended: { file: string; number: string; title: string | null; changes: number }[];
}

export interface ActObject {
  schema: string;
  path: string;
  slug: string;
  alias: string | null;
  kind: string;
  year: number;
  number: string;
  title: string;
  short: string | null;
  code: string | null;
  status: string;
  portal: string;
  from: string;
  latest: string;
  freshness: Freshness | null;
  headings?: ActHeading[];
  articles: ActArticleEntry[];
  timeline: TimelineEntry[];
  stats: ActStats;
  rulings: RulingSummary[];
  laws: LawRef[];
}

export interface LawChange {
  act_path: string;
  file: string;
  number: string;
  verb: EventVerb;
  units: string[];
  date: string;
}

export interface LawObject {
  schema: string;
  key: string;
  label: string;
  kind: string;
  title: string;
  enacted: string | null;
  published: string | null;
  in_force: string[];
  source: string | null;
  mo: string | null;
  changes: LawChange[];
}

export interface RulingObject {
  schema: string;
  key: string;
  label: string;
  court: string;
  court_name: string;
  kind: string;
  heading: string;
  subtitle: string | null;
  date: string;
  binding_from: string | null;
  mo: Record<string, unknown>;
  outcome: string;
  finds_unconstitutional: boolean;
  dossiers: string[];
  operative: string[];
  text: string | null;
  subjects: { act_path: string; articles: string[] }[];
  source: string | null;
  folder: string;
  articles: { act_path: string; file: string }[];
}

export interface ChangeItem {
  date: string;
  act_path: string;
  file: string;
  number: string;
  title: string | null;
  verb: EventVerb;
  units: string[];
  law: LawRef | null;
}

export interface ChangesObject {
  schema: string;
  scope: string;
  items: ChangeItem[];
  upcoming: ChangeItem[];
}

export interface ManifestAct {
  path: string;
  alias: string | null;
  title: string;
  short: string | null;
  status: string;
  latest: string;
  from?: string;
  articles?: number;
  versions?: number;
  freshness_status: FreshnessStatus | null;
}

export interface ActIndexEntry {
  path: string;
  alias: string | null;
  title: string;
  short: string | null;
  kind: string;
  status: string;
  from: string | null;
  latest: string;
  articles: number;
}

export interface ActIndex {
  schema: string;
  acts: ActIndexEntry[];
}

export interface OfficialSource {
  name: string;
  state: "available" | "unavailable";
  unavailable_since: string | null;
  last_successful_contact: string | null;
  as_of: string;
}

export interface PipelineStatus {
  schema: string;
  generated: string;
  updates: string;
  last_published: string;
  published_last_24h: { commits: number; new_acts: number };
  official_sources: OfficialSource[];
  note: string;
}

export interface Manifest {
  schema: string;
  build: string;
  source_head: string;
  generated: string;
  counts: { acts: number; articles: number; versions: number; laws: number; rulings: number };
  acts: ManifestAct[];
  freshness: { as_of: string | null; checked_against_official_source: string | null };
  status: PipelineStatus;
}

export interface SearchHit {
  actPath: string;
  file: string;
  number: string;
  title: string | null;
  state: ArticleState;
  snippet: string;
}
