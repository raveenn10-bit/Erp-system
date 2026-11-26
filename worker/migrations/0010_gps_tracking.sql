-- Live GPS sales rep tracking (additive only: new tables + indexes, no changes to existing data).

-- One row per "Start duty" → "End duty". Ids are generated on the device so duty
-- can start/end offline and replay safely.
CREATE TABLE rep_duty_sessions(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT,
  source TEXT NOT NULL CHECK(source IN('web','android')),
  start_lat REAL, start_lng REAL,
  end_lat REAL, end_lng REAL,
  created_at TEXT NOT NULL,
  CHECK(ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX rep_duty_one_open ON rep_duty_sessions(user_id) WHERE ended_at IS NULL;
CREATE INDEX rep_duty_user_started ON rep_duty_sessions(user_id, started_at);

-- Route points (thinned on the server: stationary points are not stored every 30 s).
-- id is generated on the device → re-sent points are ignored (no duplicates).
CREATE TABLE rep_locations(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL REFERENCES rep_duty_sessions(id),
  recorded_at TEXT NOT NULL,
  lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180),
  accuracy_m REAL CHECK(accuracy_m IS NULL OR accuracy_m >= 0),
  speed_mps REAL,
  heading REAL,
  battery INTEGER CHECK(battery IS NULL OR battery BETWEEN 0 AND 100),
  source TEXT NOT NULL CHECK(source IN('web','android')),
  received_at TEXT NOT NULL
);
CREATE INDEX rep_locations_user_time ON rep_locations(user_id, recorded_at);
CREATE INDEX rep_locations_session ON rep_locations(session_id, recorded_at);

-- Latest position + heartbeat per rep (one row each) for the live map.
CREATE TABLE rep_presence(
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  session_id TEXT,
  lat REAL, lng REAL, accuracy_m REAL, battery INTEGER,
  source TEXT,
  recorded_at TEXT,
  received_at TEXT NOT NULL
);

-- Shop check-ins made by reps while on duty.
CREATE TABLE customer_visits(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  session_id TEXT REFERENCES rep_duty_sessions(id),
  visited_at TEXT NOT NULL,
  lat REAL, lng REAL, accuracy_m REAL,
  distance_m REAL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX customer_visits_user_time ON customer_visits(user_id, visited_at);
CREATE INDEX customer_visits_customer ON customer_visits(customer_id, visited_at);

-- Shop GPS position, saved from the first accurate check-in (admin can reset it).
CREATE TABLE customer_geo(
  customer_id TEXT PRIMARY KEY REFERENCES customers(id),
  lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180),
  accuracy_m REAL,
  set_by TEXT REFERENCES users(id),
  set_at TEXT NOT NULL
);
