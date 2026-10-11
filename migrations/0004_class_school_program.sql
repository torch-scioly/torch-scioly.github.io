-- Which school a class is for, and which program it belongs to.
-- Existing classes are QVMS Science Olympiad; SBE runs Number Sense.
ALTER TABLE classes ADD COLUMN school TEXT NOT NULL DEFAULT 'QVMS';
ALTER TABLE classes ADD COLUMN program TEXT NOT NULL DEFAULT 'Science Olympiad';
