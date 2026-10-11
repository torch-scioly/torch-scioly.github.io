-- Who teaches each course (from courses.html), so a held class with no volunteer
-- signed up still credits its instructor. A class matches when its title contains
-- the keyword (case-insensitive). Public info only.
CREATE TABLE course_instructors (
  keyword TEXT NOT NULL,
  slug TEXT NOT NULL,
  PRIMARY KEY (keyword, slug)
);

INSERT INTO course_instructors (keyword, slug) VALUES
  ('anatomy', 'anvitha-gottipati'),
  ('experimental design', 'anvitha-gottipati'),
  ('botany', 'jairam-susarla'),
  ('meteorology', 'jairam-susarla'),
  ('crime busters', 'adhya-kidiyoor'),
  ('genetics', 'adhya-kidiyoor'),
  ('water quality', 'veda-khande'),
  ('food science', 'veda-khande'),
  ('rocks', 'vibha-chunduri'),
  ('solar', 'vibha-chunduri'),
  ('code busters', 'shruthi-ramkumar'),
  ('code busters', 'aditya-jetti'),
  ('wgyn', 'shruthi-ramkumar'),
  ('got your number', 'shruthi-ramkumar'),
  ('cad', 'aditya-jetti'),
  ('disease detectives', 'akshara-malepati'),
  ('scrambler', 'akshara-malepati');
