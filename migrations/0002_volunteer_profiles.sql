-- Links a volunteer card on volunteers.html (by its element id) to the email(s)
-- that volunteer uses on class signups, so /api/stats can report hours taught.
-- A volunteer may have several emails (one row each).
-- Rows are loaded directly into the remote DB, never committed (emails are private).
CREATE TABLE volunteer_profiles (
  slug TEXT NOT NULL,
  email TEXT NOT NULL,
  PRIMARY KEY (slug, email)
);
