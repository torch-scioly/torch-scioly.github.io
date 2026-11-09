import { describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JS_PATH = path.resolve(__dirname, '../../js/tests-admin.js');
const SOURCE = fs.readFileSync(JS_PATH, 'utf-8');

function setup() {
  const window = new Window();
  window.XLSX = XLSX;
  window.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }));
  const context = vm.createContext(window);
  vm.runInContext(SOURCE, context, { filename: JS_PATH });
  return window;
}

const HEADERS = ['#', 'Topic', 'Type', 'Question', 'A', 'B', 'C', 'D', 'E', 'F', 'Answer', 'Tolerance', 'Points', 'Image', 'Explanation'];

// Mirrors TORCH-test-template.xlsx: title rows, then Field/Value rows from row 4.
function templateWorkbook(extraRows = []) {
  const info = XLSX.utils.aoa_to_sheet([
    ['TORCH Practice Test'],
    ['Fill in the yellow cells.'],
    [],
    ['Title', 'Example: Meteorology Quiz 1'],
    ['Event', 'Meteorology'],
    ['Division', 'B'],
    ['Format', 'Quiz'],
    ['Time limit (min)', 15],
    ['School', 'QVMS'],
    ['Written by', 'Your name'],
    ['Notes', ''],
  ]);
  const rows = [
    HEADERS,
    [1, 'Fronts', 'Multiple choice', 'Steady rain?', 'Cold', 'Warm', 'Occluded', 'Dry line', '', '', 'B', '', 1, '', 'Warm air rises'],
    [2, 'Clouds', 'Pick all that apply', 'Low clouds?', 'Stratus', 'Cirrus', 'Nimbostratus', 'Cirrostratus', '', '', 'A,C', '', 2, '', ''],
    [3, 'Moisture', 'Number', 'Cloud base?', '', '', '', '', '', '', 875, 50, 2, '', ''],
    [4, 'Instruments', 'Short answer', 'Measures pressure?', '', '', '', '', '', '', 'barometer', '', 1, '', ''],
    [5, 'Maps', 'Written answer', 'Why falling pressure?', '', '', '', '', '', '', 'Low pressure, rising air', '', 3, '', ''],
    ...extraRows,
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, info, 'Test info');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['hidden']]), 'Lists');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Questions');
  return wb;
}

describe('workbookToPayload', () => {
  it('reads the Test info fields and the questions', () => {
    const window = setup();
    const payload = window.workbookToPayload(templateWorkbook());
    expect(payload.info).toMatchObject({ Title: 'Example: Meteorology Quiz 1', Event: 'Meteorology', Division: 'B', 'Time limit (min)': 15, School: 'QVMS' });
    expect(payload.questions).toHaveLength(5);
    expect(payload.questions[1]).toMatchObject({ Type: 'Pick all that apply', Answer: 'A,C', A: 'Stratus' });
    expect(payload.questions[2]).toMatchObject({ Answer: 875, Tolerance: 50 });
  });

  it('keeps a blank row in the middle so row numbers stay right', () => {
    const window = setup();
    const wb = templateWorkbook();
    const sheet = wb.Sheets.Questions;
    XLSX.utils.sheet_add_aoa(sheet, [['', '', '', '']], { origin: 'A3' });
    const payload = window.workbookToPayload(wb);
    expect(payload.questions[1].Question).toBe('');
    expect(payload.questions[2].Question).toBe('Cloud base?');
  });

  it('ignores trailing empty rows', () => {
    const window = setup();
    const payload = window.workbookToPayload(templateWorkbook([[], ['', '', ''], []]));
    expect(payload.questions.filter((q) => q.Question)).toHaveLength(5);
  });

  it('says which tab is missing', () => {
    const window = setup();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Sheet1');
    expect(() => window.workbookToPayload(wb)).toThrow('This file has no "Test info" tab. Use the TORCH test template.');
  });
});
