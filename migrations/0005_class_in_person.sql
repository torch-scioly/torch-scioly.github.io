-- In-person classes have no Zoom link. SBE sessions are held at the school.
ALTER TABLE classes ADD COLUMN in_person INTEGER NOT NULL DEFAULT 0;
UPDATE classes SET in_person = 1 WHERE school = 'SBE';
