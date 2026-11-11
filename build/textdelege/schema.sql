-- schema_version: 2
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS acts (
  path TEXT PRIMARY KEY,
  alias TEXT,
  slug TEXT,
  kind TEXT,
  title TEXT,
  short TEXT,
  status TEXT,
  freshness_status TEXT
);

CREATE TABLE IF NOT EXISTS articles (
  act_path TEXT NOT NULL,
  file TEXT NOT NULL,
  number TEXT,
  title TEXT,
  state TEXT,
  versions INTEGER,
  first_date TEXT,
  last_change TEXT,
  PRIMARY KEY (act_path, file)
);

CREATE TABLE IF NOT EXISTS versions (
  act_path TEXT NOT NULL,
  file TEXT NOT NULL,
  idx INTEGER NOT NULL,
  from_date TEXT,
  until_date TEXT,
  law_key TEXT,
  kind TEXT,
  PRIMARY KEY (act_path, file, idx)
);

CREATE TABLE IF NOT EXISTS laws (
  key TEXT PRIMARY KEY,
  label TEXT,
  kind TEXT,
  published TEXT
);

CREATE TABLE IF NOT EXISTS events (
  act_path TEXT NOT NULL,
  file TEXT NOT NULL,
  date TEXT,
  verb TEXT,
  law_key TEXT,
  kind TEXT
);
CREATE INDEX IF NOT EXISTS events_by_date ON events (date);
CREATE INDEX IF NOT EXISTS events_by_article ON events (act_path, file);

CREATE TABLE IF NOT EXISTS rulings (
  key TEXT PRIMARY KEY,
  label TEXT,
  court TEXT,
  date TEXT,
  outcome TEXT
);

CREATE TABLE IF NOT EXISTS ruling_subjects (
  ruling_key TEXT NOT NULL,
  act_path TEXT NOT NULL,
  file TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ruling_subjects_by_act ON ruling_subjects (act_path);
CREATE INDEX IF NOT EXISTS ruling_subjects_by_ruling ON ruling_subjects (ruling_key);

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  act_path UNINDEXED,
  file UNINDEXED,
  state UNINDEXED,
  number,
  title,
  text,
  tokenize = 'unicode61 remove_diacritics 2'
);
