CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at INTEGER NOT NULL,
  event TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_received_at ON events(received_at);
