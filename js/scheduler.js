// 합주 가능 시간 계산. 순수 함수만 있으며 DOM/저장소에 의존하지 않는다.
//
// 용어
//  - kind: 'evening' (평일, 19~21 한 슬롯) | 'day' (주말·공휴일, 9~21을 1시간 슬롯 12개)
//  - members: { [이름]: { unavailable: { [날짜]: 'all' | [시각, ...] } } }
//    'all'은 그 날 전체 불가. 시각 h는 h시~h+1시 구간을 뜻한다.

export const EVENING_START = 19;
export const EVENING_END = 21;
export const DAY_START = 9;
export const DAY_END = 21;
export const DURATION = 2; // 합주 시간(고정)

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

export function dateRange(start, end) {
  const out = [];
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) out.push(cur);
  return out;
}

export function weekday(s) {
  return parseDate(s).getDay(); // 0=일 ... 6=토
}

export function isHoliday(date, holidays) {
  return Array.isArray(holidays) ? holidays.includes(date) : Boolean(holidays && holidays[date]);
}

export function dayKind(date, holidays) {
  const w = weekday(date);
  if (w === 0 || w === 6 || isHoliday(date, holidays)) return 'day';
  return 'evening';
}

export function slotsFor(kind) {
  if (kind === 'evening') return [EVENING_START];
  const out = [];
  for (let h = DAY_START; h < DAY_END; h++) out.push(h);
  return out;
}

export function slotLength(kind) {
  return kind === 'evening' ? EVENING_END - EVENING_START : 1;
}

export function isUnavailable(member, date, hour) {
  const u = member && member.unavailable && member.unavailable[date];
  if (!u) return false;
  if (u === 'all') return true;
  return Array.isArray(u) && u.includes(hour);
}

// 자유 시각 목록(오름차순)에서 DURATION 이상 이어지는 구간을 찾는다.
export function freeRuns(freeHours, kind) {
  if (kind === 'evening') {
    return freeHours.length ? [{ start: EVENING_START, end: EVENING_END }] : [];
  }
  const runs = [];
  let i = 0;
  while (i < freeHours.length) {
    let j = i;
    while (j + 1 < freeHours.length && freeHours[j + 1] === freeHours[j] + 1) j++;
    const start = freeHours[i];
    const end = freeHours[j] + 1;
    if (end - start >= DURATION) runs.push({ start, end });
    i = j + 1;
  }
  return runs;
}

// 한 날짜에 대한 계산. exclude에 든 이름은 무시한다.
export function computeDay(date, holidays, members, exclude = []) {
  const kind = dayKind(date, holidays);
  const names = Object.keys(members).filter((n) => !exclude.includes(n));
  const blockers = {}; // hour -> [names]
  const free = [];
  for (const h of slotsFor(kind)) {
    const who = names.filter((n) => isUnavailable(members[n], date, h));
    if (who.length) blockers[h] = who;
    else free.push(h);
  }
  return { date, kind, runs: freeRuns(free, kind), blockers };
}

export function computeAvailability(session, members, exclude = []) {
  const out = {};
  for (const date of dateRange(session.start, session.end)) {
    out[date] = computeDay(date, session.holidays || [], members, exclude);
  }
  return out;
}

export function availableDates(result) {
  return Object.values(result).filter((d) => d.runs.length).map((d) => d.date);
}

// 한 명씩 빼 보고, 전원 가능한 날에 더해 "새로 생기는" 날이 있는 경우만 모은다.
// dates: 그 사람을 뺐을 때 가능한 모든 날, added: 그중 전원 가능에는 없던 날.
export function findWithOneExcluded(session, members) {
  const base = new Set(availableDates(computeAvailability(session, members)));
  const out = [];
  for (const name of Object.keys(members)) {
    const result = computeAvailability(session, members, [name]);
    const dates = availableDates(result);
    const added = dates.filter((d) => !base.has(d));
    if (added.length) out.push({ excluded: name, result, dates, added });
  }
  out.sort((a, b) => b.added.length - a.added.length);
  return out;
}

export function formatRun(run) {
  return `${run.start}~${run.end}시`;
}
