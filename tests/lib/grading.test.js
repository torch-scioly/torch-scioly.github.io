import { describe, expect, it } from 'vitest';
import { gradeAuto, gradeWritten } from '../../functions/api/_lib/grading.js';

const mc = { type: 'Multiple choice', answer: 'B', points: 1 };
const pick = { type: 'Pick all that apply', answer: 'A,B,D', points: 2 };
const number = { type: 'Number', answer: '2.7', tolerance: 0.05, points: 2 };
const short = { type: 'Short answer', answer: 'Mendel|Gregor Mendel', points: 1 };
const written = { type: 'Written answer', prompt: 'Genotype vs phenotype?', answer: 'Genotype = alleles; phenotype = trait', points: 3 };

function fakeAi(response) {
  const calls = [];
  return { calls, run: async (model, input) => { calls.push({ model, input }); if (response instanceof Error) throw response; return { response }; } };
}

describe('gradeAuto', () => {
  it('grades multiple choice by exact letter', () => {
    expect(gradeAuto(mc, 'B')).toEqual({ points: 1, status: 'correct' });
    expect(gradeAuto(mc, 'b')).toEqual({ points: 1, status: 'correct' });
    expect(gradeAuto(mc, 'C')).toEqual({ points: 0, status: 'wrong' });
  });

  it('gives partial credit on pick-all', () => {
    expect(gradeAuto(pick, 'A,B').points).toBeCloseTo(1.333, 2);
    expect(gradeAuto(pick, 'A,B').status).toBe('partial');
    expect(gradeAuto(pick, 'A,B,C').points).toBeCloseTo(0.667, 2);
    expect(gradeAuto(pick, 'C')).toEqual({ points: 0, status: 'wrong' });
    expect(gradeAuto(pick, 'D,B,A')).toEqual({ points: 2, status: 'correct' });
  });

  it('accepts numbers within tolerance', () => {
    expect(gradeAuto(number, '2.68').status).toBe('correct');
    expect(gradeAuto(number, '2.8').status).toBe('wrong');
    expect(gradeAuto(number, 'abc').status).toBe('wrong');
    expect(gradeAuto({ ...number, tolerance: null, answer: '300' }, '300').status).toBe('correct');
  });

  it('matches short answers loosely', () => {
    expect(gradeAuto(short, ' Gregor  Mendel. ').status).toBe('correct');
    expect(gradeAuto(short, 'mendel').status).toBe('correct');
    expect(gradeAuto(short, 'Darwin').status).toBe('wrong');
  });

  it('marks a blank response wrong', () => {
    expect(gradeAuto(mc, '')).toEqual({ points: 0, status: 'wrong' });
    expect(gradeAuto(short, null)).toEqual({ points: 0, status: 'wrong' });
  });
});

describe('gradeWritten', () => {
  it('clamps points above the max', async () => {
    const result = await gradeWritten(fakeAi('Sure! {"points": 5, "feedback": "Good"}'), written, 'Genotype is alleles');
    expect(result).toEqual({ points: 3, status: 'correct', feedback: 'Good', gradedBy: 'ai' });
  });

  it('clamps negative points to zero', async () => {
    const result = await gradeWritten(fakeAi('{"points": -1, "feedback": "No"}'), written, 'idk');
    expect(result).toMatchObject({ points: 0, status: 'wrong', gradedBy: 'ai' });
  });

  it('rounds to the nearest half point', async () => {
    const result = await gradeWritten(fakeAi('{"points": 2.2, "feedback": "Close"}'), written, 'partly');
    expect(result).toMatchObject({ points: 2, status: 'partial' });
  });

  it('sends prose to a volunteer', async () => {
    const result = await gradeWritten(fakeAi('I think it is good'), written, 'answer');
    expect(result).toEqual({ points: null, status: 'needs_volunteer', feedback: null, gradedBy: null });
  });

  it('sends AI failures to a volunteer', async () => {
    const result = await gradeWritten(fakeAi(new Error('quota')), written, 'answer');
    expect(result.status).toBe('needs_volunteer');
  });

  it('sends to a volunteer when there is no AI binding', async () => {
    expect((await gradeWritten(undefined, written, 'answer')).status).toBe('needs_volunteer');
  });

  it('scores a blank answer without calling the AI', async () => {
    const ai = fakeAi('{"points": 3}');
    const result = await gradeWritten(ai, written, '  ');
    expect(result).toEqual({ points: 0, status: 'wrong', feedback: 'No answer given.', gradedBy: 'auto' });
    expect(ai.calls).toHaveLength(0);
  });

  it('sends the rubric and answer to the pinned model', async () => {
    const ai = fakeAi('{"points": 3, "feedback": "ok"}');
    await gradeWritten(ai, written, 'Genotype is alleles');
    expect(ai.calls[0].model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    const sent = JSON.stringify(ai.calls[0].input);
    expect(sent).toContain('Genotype = alleles; phenotype = trait');
    expect(sent).toContain('Genotype is alleles');
  });
});
