// Validates and normalizes a test uploaded from TORCH-test-template.xlsx.
// The payload keys are the template's exact header names. Errors name the spreadsheet
// row (the header is row 1) so volunteers can find and fix them.
import { SCHOOLS } from './schools.js';

export const QUESTION_TYPES = ['Multiple choice', 'Pick all that apply', 'Number', 'Short answer', 'Written answer'];
const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const CHOICE_TYPES = ['Multiple choice', 'Pick all that apply'];

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function toNumber(value) {
  const t = text(value);
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function validateInfo(info, errors) {
  const title = text(info.Title);
  const event = text(info.Event);
  const division = text(info.Division).toUpperCase();
  const format = text(info.Format);
  const school = text(info.School).toUpperCase();
  const timeLimit = toNumber(info['Time limit (min)']);

  if (!title) errors.push('Test info: Title is required');
  if (!event) errors.push('Test info: Event is required');
  if (!['B', 'C'].includes(division)) errors.push('Test info: Division must be B or C');
  const normalizedFormat = ['Quiz', 'Tournament'].find((f) => f.toLowerCase() === format.toLowerCase());
  if (!normalizedFormat) errors.push('Test info: Format must be Quiz or Tournament');
  if (!SCHOOLS.includes(school)) errors.push(`Test info: School must be one of ${SCHOOLS.join(', ')}`);
  if (Number.isNaN(timeLimit) || (timeLimit !== null && timeLimit <= 0)) {
    errors.push('Test info: Time limit must be a positive number of minutes');
  }

  return {
    title, event, division, format: normalizedFormat, school,
    timeLimitMin: timeLimit && timeLimit > 0 ? Math.round(timeLimit) : null,
    writtenBy: text(info['Written by']),
    notes: text(info.Notes),
  };
}

function validateQuestion(row, rowNumber, position, errors) {
  const prefix = `Row ${rowNumber}:`;
  const rawType = text(row.Type);
  const type = QUESTION_TYPES.find((t) => t.toLowerCase() === rawType.toLowerCase());
  const prompt = text(row.Question);
  const rowErrors = [];

  if (!type) rowErrors.push(`${prefix} unknown type "${rawType}"`);
  if (!prompt) rowErrors.push(`${prefix} Question is required`);
  if (text(row.Image)) rowErrors.push(`${prefix} images aren't supported yet — remove the Image value.`);

  const points = toNumber(row.Points);
  if (Number.isNaN(points) || (points !== null && points <= 0)) rowErrors.push(`${prefix} Points must be a positive number`);

  let answer = text(row.Answer);
  let choices = null;
  let tolerance = null;
  if (!answer) rowErrors.push(`${prefix} Answer is required`);

  if (type && answer && CHOICE_TYPES.includes(type)) {
    choices = CHOICE_LETTERS.map((l) => text(row[l]));
    while (choices.length && !choices[choices.length - 1]) choices.pop();
    if (choices.length < 2) rowErrors.push(`${prefix} needs at least two choices`);
    const letters = [...new Set(answer.toUpperCase().split(',').map((l) => l.trim()).filter(Boolean))].sort();
    if (type === 'Multiple choice' && letters.length !== 1) rowErrors.push(`${prefix} Multiple choice needs exactly one answer letter`);
    for (const letter of letters) {
      const index = CHOICE_LETTERS.indexOf(letter);
      if (index === -1 || !choices[index]) rowErrors.push(`${prefix} answer ${letter} is not one of the choices`);
    }
    answer = letters.join(',');
  } else if (type === 'Number' && answer) {
    const n = toNumber(answer);
    if (n === null || Number.isNaN(n)) rowErrors.push(`${prefix} answer must be a number`);
    else answer = String(n);
    const tol = toNumber(row.Tolerance);
    if (Number.isNaN(tol) || (tol !== null && tol < 0)) rowErrors.push(`${prefix} Tolerance must be a number`);
    else tolerance = tol;
  }

  errors.push(...rowErrors);
  return {
    position, topic: text(row.Topic) || null, type, prompt, choices, answer, tolerance,
    points: points && points > 0 ? points : 1,
    explanation: text(row.Explanation) || null,
  };
}

export function validateTest(payload) {
  const errors = [];
  const info = validateInfo(payload?.info || {}, errors);

  const rows = Array.isArray(payload?.questions) ? payload.questions : [];
  const questions = [];
  rows.forEach((row, i) => {
    if (!text(row?.Question) && !text(row?.Type)) return;
    questions.push(validateQuestion(row, i + 2, questions.length + 1, errors));
  });
  if (questions.length === 0) errors.push('The Questions tab has no questions');

  return errors.length ? { errors, test: null } : { errors, test: { ...info, questions } };
}
