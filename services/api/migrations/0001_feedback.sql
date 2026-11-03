CREATE TABLE IF NOT EXISTS feedback (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  version TEXT    NOT NULL DEFAULT '',
  metric  TEXT    NOT NULL,
  vote    INTEGER NOT NULL CHECK (vote IN (-1, 1))
);
CREATE INDEX IF NOT EXISTS feedback_metric ON feedback (metric);
