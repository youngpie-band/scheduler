import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateRange, dayKind, computeDay, computeAvailability, availableDates,
  findWithOneExcluded, freeRuns,
} from '../js/scheduler.js';

// 2026-09-14(월) ~ 2026-09-20(일)
const session = { start: '2026-09-14', end: '2026-09-20', holidays: ['2026-09-16'] };

test('dateRange covers both ends', () => {
  assert.deepEqual(dateRange('2026-09-30', '2026-10-02'), ['2026-09-30', '2026-10-01', '2026-10-02']);
});

test('dayKind: weekday=evening, weekend/holiday=day', () => {
  assert.equal(dayKind('2026-09-14', []), 'evening'); // 월
  assert.equal(dayKind('2026-09-19', []), 'day');     // 토
  assert.equal(dayKind('2026-09-20', []), 'day');     // 일
  assert.equal(dayKind('2026-09-16', ['2026-09-16']), 'day'); // 공휴일 지정
});

test('freeRuns finds contiguous 2h+ blocks', () => {
  assert.deepEqual(freeRuns([9, 10, 11, 13, 15, 16, 17, 18, 20], 'day'),
    [{ start: 9, end: 12 }, { start: 15, end: 19 }]);
  assert.deepEqual(freeRuns([9, 10], 'day'), [{ start: 9, end: 11 }]);
  assert.deepEqual(freeRuns([9], 'day'), []);
  assert.deepEqual(freeRuns([19], 'evening'), [{ start: 19, end: 21 }]);
  assert.deepEqual(freeRuns([], 'evening'), []);
});

test('weekday: any member marking the day blocks it', () => {
  const members = {
    A: { unavailable: { '2026-09-14': 'all' } },
    B: { unavailable: {} },
  };
  const mon = computeDay('2026-09-14', [], members);
  assert.deepEqual(mon.runs, []);
  assert.deepEqual(mon.blockers, { 19: ['A'] });
  const tue = computeDay('2026-09-15', [], members);
  assert.deepEqual(tue.runs, [{ start: 19, end: 21 }]);
});

test('weekend: union of unavailable hours, runs of 2h+', () => {
  const members = {
    A: { unavailable: { '2026-09-19': [9, 10, 11] } },
    B: { unavailable: { '2026-09-19': [15, 16, 17] } },
    C: { unavailable: {} },
  };
  const sat = computeDay('2026-09-19', [], members);
  assert.deepEqual(sat.runs, [{ start: 12, end: 15 }, { start: 18, end: 21 }]);
  assert.deepEqual(sat.blockers[9], ['A']);
  assert.deepEqual(sat.blockers[15], ['B']);
});

test('member with "all" on weekend blocks every slot', () => {
  const members = { A: { unavailable: { '2026-09-19': 'all' } } };
  assert.deepEqual(computeDay('2026-09-19', [], members).runs, []);
});

test('holiday weekday uses day grid', () => {
  const members = { A: { unavailable: { '2026-09-16': [9, 10, 11, 12, 13, 14, 15, 16, 17, 18] } } };
  const r = computeDay('2026-09-16', session.holidays, members);
  assert.equal(r.kind, 'day');
  assert.deepEqual(r.runs, [{ start: 19, end: 21 }]);
});

test('findWithOneExcluded finds who to drop', () => {
  const members = {
    A: { unavailable: { '2026-09-14': 'all', '2026-09-15': 'all', '2026-09-17': 'all', '2026-09-18': 'all', '2026-09-16': 'all', '2026-09-19': 'all', '2026-09-20': 'all' } },
    B: { unavailable: { '2026-09-19': 'all', '2026-09-20': 'all' } },
  };
  assert.deepEqual(availableDates(computeAvailability(session, members)), []);
  const alt = findWithOneExcluded(session, members);
  assert.equal(alt[0].excluded, 'A');
  assert.deepEqual(alt[0].dates, ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']);
  assert.deepEqual(alt[0].added, alt[0].dates);
  // B를 빼도 A가 다 막고 있으므로 후보 없음
  assert.equal(alt.some((x) => x.excluded === 'B'), false);
});

test('findWithOneExcluded counts only newly gained dates', () => {
  // A만 월요일 불가. 이미 6일이 전원 가능하므로 A를 빼면 월요일 하루만 새로 생긴다.
  const members = { A: { unavailable: { '2026-09-14': 'all' } }, B: { unavailable: {} } };
  const alt = findWithOneExcluded(session, members);
  assert.equal(alt.length, 1);
  assert.equal(alt[0].excluded, 'A');
  assert.deepEqual(alt[0].added, ['2026-09-14']);
  // 아무도 막지 않으면 후보 없음
  assert.deepEqual(findWithOneExcluded(session, { A: { unavailable: {} } }), []);
});
