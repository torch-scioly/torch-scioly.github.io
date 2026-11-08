-- Practice tests: parents register kids (with consent), kids take auto-graded tests,
-- staff upload tests and review results. See docs/superpowers/specs/2026-11-07-practice-tests-design.md.
CREATE TABLE parents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  school TEXT NOT NULL,
  consent_terms_version TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  link_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE kids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL REFERENCES parents(id),
  school TEXT NOT NULL,
  display_name TEXT NOT NULL,
  grade TEXT,
  username TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  failed_pins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school TEXT NOT NULL,
  title TEXT NOT NULL,
  event TEXT NOT NULL,
  division TEXT NOT NULL,
  format TEXT NOT NULL,
  time_limit_min INTEGER,
  written_by TEXT,
  notes TEXT,
  published INTEGER NOT NULL DEFAULT 1,
  session_only INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE test_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL REFERENCES tests(id),
  position INTEGER NOT NULL,
  topic TEXT,
  type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  choices_json TEXT,
  answer TEXT NOT NULL,
  tolerance REAL,
  points REAL NOT NULL,
  explanation TEXT
);

CREATE TABLE test_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL REFERENCES tests(id),
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL REFERENCES tests(id),
  kid_id INTEGER NOT NULL REFERENCES kids(id),
  session_id INTEGER REFERENCES test_sessions(id),
  started_at TEXT NOT NULL,
  deadline_at TEXT,
  submitted_at TEXT,
  score REAL,
  max_score REAL,
  is_first INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE attempt_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  question_id INTEGER NOT NULL REFERENCES test_questions(id),
  response TEXT,
  points REAL,
  status TEXT,
  graded_by TEXT,
  feedback TEXT,
  override_note TEXT,
  UNIQUE (attempt_id, question_id)
);

CREATE TABLE study_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  topic TEXT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  added_by TEXT
);

-- Free study links. topic NULL = applies to the whole event.
INSERT INTO study_resources (event, topic, title, url, added_by) VALUES
  ('Heredity', NULL, 'Scioly.org wiki: Heredity', 'https://scioly.org/wiki/index.php/Heredity', 'TORCH'),
  ('Heredity', NULL, 'Khan Academy: Classical genetics', 'https://www.khanacademy.org/science/biology/classical-genetics', 'TORCH'),
  ('Heredity', 'Sex-linked traits', 'Khan Academy: Sex linkage', 'https://www.khanacademy.org/science/biology/classical-genetics/sex-linkage-non-nuclear-chromosomal-mutations', 'TORCH'),
  ('Heredity', NULL, 'OpenStax Biology 2e (free textbook)', 'https://openstax.org/details/books/biology-2e', 'TORCH'),
  ('Crime Busters', NULL, 'Scioly.org wiki: Crime Busters', 'https://scioly.org/wiki/index.php/Crime_Busters', 'TORCH'),
  ('Crime Busters', NULL, 'Scioly.org wiki: Forensics (Division C version)', 'https://scioly.org/wiki/index.php/Forensics', 'TORCH'),
  ('Crime Busters', NULL, 'Khan Academy: Chemistry', 'https://www.khanacademy.org/science/chemistry', 'TORCH'),
  ('Circuit Lab', NULL, 'Scioly.org wiki: Circuit Lab', 'https://scioly.org/wiki/index.php/Circuit_Lab', 'TORCH'),
  ('Circuit Lab', NULL, 'Khan Academy: Circuits', 'https://www.khanacademy.org/science/physics/circuits-topic', 'TORCH'),
  ('Circuit Lab', 'Series circuits', 'Khan Academy: Resistors in series and parallel', 'https://www.khanacademy.org/science/physics/circuits-topic/circuits-resistance', 'TORCH'),
  ('Circuit Lab', 'Parallel circuits', 'Khan Academy: Resistors in series and parallel', 'https://www.khanacademy.org/science/physics/circuits-topic/circuits-resistance', 'TORCH'),
  ('Circuit Lab', 'Ohm''s law', 'Khan Academy: Resistors in series and parallel', 'https://www.khanacademy.org/science/physics/circuits-topic/circuits-resistance', 'TORCH'),
  ('History of Science', NULL, 'Science History Institute: Stories', 'https://www.sciencehistory.org/stories', 'TORCH'),
  ('History of Science', NULL, 'Khan Academy: Big History Project', 'https://www.khanacademy.org/humanities/big-history-project', 'TORCH'),
  ('Meteorology', NULL, 'Scioly.org wiki: Meteorology', 'https://scioly.org/wiki/index.php/Meteorology', 'TORCH');
