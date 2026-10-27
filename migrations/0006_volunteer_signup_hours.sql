-- Hours credited for a volunteer sign-up. Classes are 1-hour slots, but volunteer-only
-- sessions (testing, TMSCA meets) can run longer for some volunteers.
ALTER TABLE volunteer_signups ADD COLUMN hours REAL NOT NULL DEFAULT 1;
