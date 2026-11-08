import { describe, expect, it } from 'vitest';
import { validateTest, QUESTION_TYPES } from '../../functions/api/_lib/test-format.js';

const INFO = {
  Title: 'Heredity Quiz 1', Event: 'Heredity', Division: 'B', Format: 'Quiz',
  'Time limit (min)': 20, School: 'QVMS', 'Written by': 'Adhya', Notes: '',
};

function mcRow(overrides = {}) {
  return {
    '#': 1, Topic: 'Monohybrid crosses', Type: 'Multiple choice', Question: 'Fraction short?',
    A: '0', B: '1/4', C: '1/2', D: '3/4', Answer: 'B', Points: 1, Explanation: 'tt only', ...overrides,
  };
}

function payload(questions, info = INFO) {
  return { info, questions };
}

describe('validateTest', () => {
  it('lists the five question types', () => {
    expect(QUESTION_TYPES).toEqual(['Multiple choice', 'Pick all that apply', 'Number', 'Short answer', 'Written answer']);
  });

  it('accepts a valid test and normalizes it', () => {
    const { errors, test } = validateTest(payload([
      mcRow(),
      { Topic: 'Meiosis', Type: 'Pick all that apply', Question: 'True of meiosis?', A: '4 cells', B: 'haploid', C: 'identical', D: 'crossing over', Answer: 'A,B,D', Points: 2 },
      { Topic: 'Crosses', Type: 'Number', Question: 'How many tall?', Answer: 300, Tolerance: '', Points: 1 },
      { Topic: 'History', Type: 'Short answer', Question: 'Father of genetics?', Answer: 'Mendel|Gregor Mendel', Points: 1 },
      { Topic: 'Vocab', Type: 'Written answer', Question: 'Genotype vs phenotype?', Answer: 'Genotype = alleles...', Points: 3 },
    ]));
    expect(errors).toEqual([]);
    expect(test).toMatchObject({ title: 'Heredity Quiz 1', event: 'Heredity', division: 'B', format: 'Quiz', timeLimitMin: 20, school: 'QVMS', writtenBy: 'Adhya' });
    expect(test.questions).toHaveLength(5);
    expect(test.questions[0]).toMatchObject({ position: 1, type: 'Multiple choice', choices: ['0', '1/4', '1/2', '3/4'], answer: 'B', points: 1 });
    expect(test.questions[2]).toMatchObject({ type: 'Number', answer: '300', tolerance: null, choices: null });
  });

  it('uppercases a single-letter answer', () => {
    expect(validateTest(payload([mcRow({ Answer: 'b' })])).test.questions[0].answer).toBe('B');
  });

  it('normalizes pick-all answers with spaces and order', () => {
    const { test } = validateTest(payload([mcRow({ Type: 'Pick all that apply', Answer: 'c, a' })]));
    expect(test.questions[0].answer).toBe('A,C');
  });

  it('matches question types case-insensitively', () => {
    expect(validateTest(payload([mcRow({ Type: 'multiple CHOICE' })])).test.questions[0].type).toBe('Multiple choice');
  });

  it('keeps a numeric answer like 2.7 and its tolerance', () => {
    const { test } = validateTest(payload([{ Type: 'Number', Question: 'Density?', Answer: 2.7, Tolerance: 0.05, Points: 2 }]));
    expect(test.questions[0]).toMatchObject({ answer: '2.7', tolerance: 0.05 });
  });

  it('defaults blank points to 1', () => {
    expect(validateTest(payload([mcRow({ Points: '' })])).test.questions[0].points).toBe(1);
  });

  it('drops trailing blank rows', () => {
    const { errors, test } = validateTest(payload([mcRow(), { Question: '', Type: '' }, {}]));
    expect(errors).toEqual([]);
    expect(test.questions).toHaveLength(1);
  });

  it('rejects an answer letter with no matching choice', () => {
    const { errors, test } = validateTest(payload([mcRow(), mcRow({ Answer: 'E' })]));
    expect(errors).toContain('Row 3: answer E is not one of the choices');
    expect(test).toBeNull();
  });

  it('rejects a non-numeric Number answer', () => {
    const { errors } = validateTest(payload([{ Type: 'Number', Question: 'How many?', Answer: 'abc' }]));
    expect(errors).toContain('Row 2: answer must be a number');
  });

  it('rejects images for now', () => {
    const { errors } = validateTest(payload([mcRow({ Image: 'map1.png' })]));
    expect(errors).toContain("Row 2: images aren't supported yet — remove the Image value.");
  });

  it('rejects an unknown type', () => {
    const { errors } = validateTest(payload([mcRow({ Type: 'essay' })]));
    expect(errors).toContain('Row 2: unknown type "essay"');
  });

  it('requires a title', () => {
    const { errors } = validateTest(payload([mcRow()], { ...INFO, Title: '' }));
    expect(errors).toContain('Test info: Title is required');
  });

  it('rejects an unknown school', () => {
    const { errors } = validateTest(payload([mcRow()], { ...INFO, School: 'XYZ' }));
    expect(errors).toContain('Test info: School must be one of QVMS, SBE');
  });

  it('requires at least one question', () => {
    expect(validateTest(payload([])).errors).toContain('The Questions tab has no questions');
  });

  it('requires an answer', () => {
    expect(validateTest(payload([mcRow({ Answer: '' })])).errors).toContain('Row 2: Answer is required');
  });
});
