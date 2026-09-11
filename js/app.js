import { firebaseConfig, BAND_NAME, MEMBER_COUNT, ADMIN_PASSWORD_HASH } from './config.js';
import { createStore } from './store.js';
import { KR_HOLIDAYS } from './holidays.js';
import {
  dateRange, dayKind, slotsFor, parseDate, formatDate, weekday,
  computeAvailability, availableDates, findWithOneExcluded, formatRun, DURATION,
} from './scheduler.js';

const store = createStore(firebaseConfig);
const app = document.getElementById('app');
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
let unsub = null;

// ---------- 공용 ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h(`<div class="toast" role="status">${esc(msg)}</div>`);
  document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
}
// 비동기 작업 동안 버튼을 잠그고 진행 문구를 보여준다.
async function busy(btn, label, fn) {
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = label; btn.setAttribute('aria-busy', 'true');
  try { return await fn(); }
  finally { btn.disabled = false; btn.textContent = orig; btn.removeAttribute('aria-busy'); }
}
// 바텀 시트 공통: 대화상자 역할, Esc로 닫기, 열 때 포커스 이동, 닫을 때 포커스 복귀
function mountSheet(bg, sheet, onClose, label) {
  const opener = document.activeElement;
  // 닫은 뒤 화면이 다시 그려져도 같은 자리(날짜 칸이나 id)로 포커스를 돌려준다.
  const openerKey = opener && opener.dataset && opener.dataset.date ? `[data-date="${opener.dataset.date}"]` : opener && opener.id ? `#${opener.id}` : null;
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
  if (label) sheet.setAttribute('aria-label', label);
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    bg.remove(); sheet.remove();
    if (onClose) onClose();
    const target = opener && opener.isConnected ? opener : openerKey ? document.querySelector(openerKey) : null;
    if (target && target.focus) target.focus();
  };
  document.addEventListener('keydown', onKey);
  bg.onclick = close;
  document.body.append(bg, sheet);
  const first = sheet.querySelector('input, [tabindex="0"], button');
  if (first) first.focus();
  return close;
}
// 저장 실패(오프라인, 규칙 거부 등)를 사용자에게 알린다.
async function safe(promise) {
  try { return await promise; }
  catch (e) { console.error(e); toast('저장에 실패했어요. 인터넷 연결을 확인해 주세요'); throw e; }
}
// Firebase 키에 쓸 수 없는 문자
const BAD_NAME = /[.#$\[\]\/]/;
if (store.ready) store.ready.catch(() => {
  document.body.prepend(h('<div class="notice" style="margin:12px">서버에 연결하지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.</div>'));
});
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('복사했어요'); }
  catch { prompt('복사해서 공유하세요', text); }
}
function fmtK(date) {
  const d = parseDate(date);
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
}
function periodLabel(s) { return `${fmtK(s.start)} ~ ${fmtK(s.end)}`; }
function hourLabel(hh) { return `${hh}~${hh + 1}`; }
function baseUrl() { return location.href.split('#')[0]; }
function go(hash) { location.hash = hash; }
const TODAY = formatDate(new Date());
const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
function topbar(title, back = '#/home', sub = '') {
  return `<header class="appbar">${back ? `<button class="back" data-back="${back}" aria-label="뒤로">${CHEVRON}</button>` : ''}<div class="titles"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div><span class="mascot" aria-hidden="true"></span></header>`;
}
function progress(n, total) {
  const pct = Math.min(100, Math.round((n / total) * 100));
  return `<div class="progress"><i style="width:${pct}%"></i></div>`;
}
// 공지사항 판. editable이면 결과 화면에서 수정 버튼을 붙인다.
function noticeBoard(session, editable = false) {
  if (!session.notice && !editable) return '';
  const body = session.notice
    ? `<div class="board-text">${esc(session.notice)}</div>`
    : '<div class="board-text muted">공지사항이 없어요.</div>';
  return `<div class="board" id="board">
    <div class="row spread"><span class="mono">공지</span>${editable ? '<button class="small ghost" id="editNotice">수정</button>' : ''}</div>
    ${body}
  </div>`;
}
// 멤버 한마디 패널 (공지사항처럼 사람당 하나씩, unavailable 저장할 때 같이 저장됨)
function commentsPanel(members) {
  const entries = Object.entries(members).filter(([, m]) => m && m.comment && m.comment.trim());
  if (!entries.length) return '';
  return `<h2>멤버 한마디</h2>
    <ul class="comments-panel">${entries.map(([n, m]) => `
      <li class="comment-item">
        <span class="comment-avatar" aria-hidden="true">${esc([...n][0] || '?')}</span>
        <div class="comment-body"><b class="comment-name">${esc(n)}</b><p class="comment-text">${esc(m.comment)}</p></div>
      </li>`).join('')}</ul>`;
}
function bindNoticeEditor(root, session) {
  const btn = root.querySelector('#editNotice');
  if (!btn) return;
  btn.onclick = () => {
    const board = root.querySelector('#board');
    board.innerHTML = `<div class="row spread"><span class="mono">공지 수정</span></div>
      <textarea id="noticeInput" rows="4"></textarea>
      <div class="row" style="margin-top:8px"><button class="primary small" id="saveNotice">저장</button><button class="small" id="cancelNotice">취소</button></div>`;
    const ta = board.querySelector('#noticeInput'); ta.value = session.notice || ''; ta.focus();
    board.querySelector('#saveNotice').onclick = (e) => {
      const v = ta.value.trim();
      busy(e.currentTarget, '저장 중…', () => safe(store.updateSession(session.id, { notice: v || null })));
    };
    board.querySelector('#cancelNotice').onclick = () => { board.outerHTML = noticeBoard(session, true); bindNoticeEditor(root, session); };
  };
}
// ---------- 영파이 비밀번호 ----------
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function isAdmin() {
  try { return !ADMIN_PASSWORD_HASH || sessionStorage.getItem('band-admin') === ADMIN_PASSWORD_HASH; } catch { return false; }
}
// 비밀번호 시트를 띄우고, 맞으면 true. 한 번 통과하면 탭을 닫기 전까지 다시 묻지 않는다.
function requireAdmin(what = '이 작업') {
  if (isAdmin()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const bg = h('<div class="sheet-bg"></div>');
    const sheet = h(`<div class="sheet">
      <h3 style="margin-top:0">영파이 비밀번호</h3>
      <p class="muted">${esc(what)}는 영파이만 할 수 있어요. 😉</p>
      <input type="password" id="pw" autocomplete="current-password" placeholder="비밀번호">
      <div class="row" style="margin-top:12px"><button style="flex:1" id="pwCancel">취소</button><button class="primary" style="flex:1" id="pwOk">확인</button></div>
    </div>`);
    const input = sheet.querySelector('#pw');
    input.setAttribute('aria-label', '영파이 비밀번호');
    let ok = false;
    const close = mountSheet(bg, sheet, () => resolve(ok), '영파이 비밀번호 입력');
    const check = async () => {
      if (await sha256(input.value) === ADMIN_PASSWORD_HASH) {
        try { sessionStorage.setItem('band-admin', ADMIN_PASSWORD_HASH); } catch {}
        ok = true; close();
      } else { toast('비밀번호가 맞지 않아요'); input.value = ''; input.focus(); }
    };
    sheet.querySelector('#pwOk').onclick = check;
    sheet.querySelector('#pwCancel').onclick = () => close();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  });
}
// 되돌릴 수 없는 작업 앞에 띄우는 확인 시트
function confirmSheet(title, body, onYes) {
  const bg = h('<div class="sheet-bg"></div>');
  const sheet = h(`<div class="sheet">
    <h3 style="margin-top:0">${esc(title)}</h3>
    <p class="muted">${esc(body)}</p>
    <div class="row" style="margin-top:12px"><button style="flex:1" id="cfNo">취소</button><button class="danger" style="flex:1" id="cfYes">삭제</button></div>
  </div>`);
  const close = mountSheet(bg, sheet, null, title);
  sheet.querySelector('#cfNo').onclick = () => close();
  sheet.querySelector('#cfYes').onclick = () => { close(); onYes(); };
}
// 확정 순간에 한 번만 터지는 코랄 별
function starBurst(x, y) {
  const s = h(`<span class="star-burst" style="left:${x}px;top:${y}px"></span>`);
  document.body.appendChild(s); setTimeout(() => s.remove(), 500);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-back]');
  if (b) go(b.dataset.back);
});
// 오프라인 안내
const offlineBar = h('<div class="offline" role="status" hidden>오프라인이에요. 연결되면 자동으로 이어집니다.</div>');
document.body.prepend(offlineBar);
const syncOnline = () => { offlineBar.hidden = navigator.onLine; };
window.addEventListener('online', syncOnline); window.addEventListener('offline', syncOnline); syncOnline();

// ---------- 달력 ----------
// opts.cell(date, kind) -> { cls, html } ; opts.onClick(date, kind)
function renderCalendar(container, session, opts) {
  container.innerHTML = '';
  const holidays = session.holidays || [];
  const dates = dateRange(session.start, session.end);
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  for (const ym of months) {
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const daysIn = new Date(y, m, 0).getDate();
    const wrap = h(`<div class="month"><h3>${y}년 ${m}월</h3><div class="cal"></div></div>`);
    const cal = wrap.querySelector('.cal');
    DOW.forEach((d, i) => cal.appendChild(h(`<div class="dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</div>`)));
    for (let i = 0; i < first.getDay(); i++) cal.appendChild(h('<div class="cell out"></div>'));
    for (let d = 1; d <= daysIn; d++) {
      const date = formatDate(new Date(y, m - 1, d));
      const w = weekday(date);
      const inRange = date >= session.start && date <= session.end;
      const hol = holidays.includes(date);
      const kind = dayKind(date, holidays);
      const cls = ['cell', w === 0 ? 'sun' : w === 6 ? 'sat' : '', hol ? 'hol' : '', date === TODAY ? 'today' : ''];
      let inner = `<div class="d">${d}</div>`;
      if (hol) inner += `<div class="hname">${esc((KR_HOLIDAYS[date] || '휴일').replace(/대체공휴일\((.+)\)/, '$1 대체'))}</div>`;
      if (!inRange) cls.push('off');
      else if (opts.cell) { const r = opts.cell(date, kind); if (r) { if (r.cls) cls.push(r.cls); inner += r.html || ''; } }
      const clickable = inRange && opts.onClick;
      const el = h(`<div class="${cls.join(' ')}" data-date="${date}" ${clickable ? 'tabindex="0" role="button"' : ''}>${inner}</div>`);
      if (clickable) {
        el.setAttribute('aria-label', `${m}월 ${d}일 ${DOW[w]}요일${hol ? ' 공휴일' : ''}. ${el.textContent.replace(String(d), '').trim()}`);
        el.addEventListener('click', () => opts.onClick(date, kind));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onClick(date, kind); } });
      }
      cal.appendChild(el);
    }
    container.appendChild(wrap);
  }
}

// ---------- 화면: 목록 ----------
// ---------- 화면: 인트로 ----------
function viewIntro() {
  document.documentElement.classList.add('is-intro');
  app.innerHTML = `
    <section class="intro">
      <span class="mascot big" aria-hidden="true"></span>
      <h1 class="intro-title">${esc(BAND_NAME)}</h1>
      <p class="intro-tag">합주 날짜를 정해보자 🚀</p>
      <button class="primary big" id="enter">시작하기</button>
      <p class="intro-next" id="introNext"></p>
    </section>`;
  app.querySelector('#enter').onclick = () => go('#/home');
  store.listSessions().then((sessions) => {
    const up = sessions.filter((s) => !s.archived && s.confirmed && s.confirmed.date >= TODAY)
      .sort((a, b) => a.confirmed.date.localeCompare(b.confirmed.date))[0];
    const el = app.querySelector('#introNext');
    if (up && el) el.textContent = `다음 합주 · ${fmtK(up.confirmed.date)} ${up.confirmed.start}~${up.confirmed.start + DURATION}시`;
  }).catch(() => {});
}

// 홈: 다음 합주(확정) → 진행 중 취합(내 입력 여부) → 지난 합주 → 보관함
function viewList() {
  let showArchived = false;
  const myName = localStorage.getItem('band-my-name') || '';
  app.innerHTML = `
    ${topbar(BAND_NAME, '#/', '합주 날짜를 정해보자')}
    <div id="list"></div>
    <div class="row spread" style="margin-top:var(--space-lg)">
      <button class="primary" id="new">+ 새 취합 만들기</button>
      <button class="ghost small" id="arch">보관함 보기</button>
    </div>
    ${firebaseConfig ? '' : '<p class="muted">※ 현재 로컬 저장 모드예요. 이 브라우저에만 저장되고 다른 사람과 공유되지 않아요.</p>'}`;
  app.querySelector('#new').onclick = async () => { if (await requireAdmin('새 취합 만들기')) go('#/new'); };
  const list = app.querySelector('#list');
  list.innerHTML = '<p class="muted">불러오는 중...</p>';
  const timeText = (c) => `${c.start}~${c.start + DURATION}시`;

  const render = async (sessions) => {
    const withMembers = await Promise.all(sessions.map(async (s) => ({ s, members: await store.getMembers(s.id) })));
    list.innerHTML = '';
    if (showArchived) {
      const items = withMembers.filter(({ s }) => s.archived);
      list.appendChild(h('<h2>보관함</h2>'));
      if (!items.length) list.appendChild(h('<div class="empty">보관된 취합이 없어요.</div>'));
      for (const { s } of items) {
        const status = s.confirmed ? `<span class="badge ok">★ ${fmtK(s.confirmed.date)} ${timeText(s.confirmed)}</span>` : '<span class="badge">미확정</span>';
        const card = h(`<div class="card link"><div class="row spread"><b>${esc(s.title)}</b>${status}</div><div class="muted">${periodLabel(s)}</div></div>`);
        card.onclick = () => go(`#/s/${s.id}`);
        list.appendChild(card);
      }
      return;
    }
    const live = withMembers.filter(({ s }) => !s.archived);
    const upcoming = live.filter(({ s }) => s.confirmed && s.confirmed.date >= TODAY).sort((a, b) => a.s.confirmed.date.localeCompare(b.s.confirmed.date));
    const open = live.filter(({ s }) => !s.confirmed).sort((a, b) => a.s.start.localeCompare(b.s.start));
    const past = live.filter(({ s }) => s.confirmed && s.confirmed.date < TODAY).sort((a, b) => b.s.confirmed.date.localeCompare(a.s.confirmed.date));

    if (!live.length) {
      list.appendChild(h('<div class="empty">아직 합주 계획이 없어요.<br>새 취합 프로젝트를 만들어 멤버들에게 링크를 보내 주세요.</div>'));
      return;
    }
    // 다음 합주
    if (upcoming.length) {
      const { s } = upcoming[0];
      const d = parseDate(s.confirmed.date);
      const days = Math.round((d - parseDate(TODAY)) / 86400000);
      const dday = days === 0 ? '오늘' : `D-${days}`;
      const hero = h(`<div class="card hero link" role="link" tabindex="0">
        <div class="row spread"><span class="mono">다음 합주</span><span class="badge">${dday}</span></div>
        <div class="hero-date">${d.getMonth() + 1}월 ${d.getDate()}일 <small>${DOW[d.getDay()]}요일</small></div>
        <div class="hero-time">${timeText(s.confirmed)}</div>
        <div class="muted">${esc(s.title)}${s.notice ? ' · 공지 있음' : ''}</div>
      </div>`);
      hero.onclick = () => go(`#/s/${s.id}`);
      hero.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(`#/s/${s.id}`); });
      list.appendChild(hero);
      for (const { s: s2 } of upcoming.slice(1)) {
        const c = h(`<div class="card link"><div class="row spread"><b>${esc(s2.title)}</b><span class="badge ok">★ ${fmtK(s2.confirmed.date)} ${timeText(s2.confirmed)}</span></div></div>`);
        c.onclick = () => go(`#/s/${s2.id}`);
        list.appendChild(c);
      }
    }
    // 진행 중
    if (open.length) {
      list.appendChild(h('<h2>진행 중인 취합</h2>'));
      for (const { s, members } of open) {
        const n = Object.keys(members).length;
        const total = s.memberCount || MEMBER_COUNT;
        const mine = myName && members[myName];
        const card = h(`<div class="card link">
          <div class="row spread"><b>${esc(s.title)}</b><span class="badge ${n >= total ? 'ok' : ''}">${n}/${total}명</span></div>
          <div class="muted">${periodLabel(s)}</div>
          ${progress(n, total)}
          ${myName ? `<div class="muted" style="margin-top:var(--space-1)">${mine ? `✓ ${esc(myName)} 입력 완료` : `${esc(myName)} 입력 전`}</div>` : ''}
          <div class="actions" style="margin-top:var(--space-3)">
            <button class="${mine ? '' : 'primary'}" data-input="${s.id}">${mine ? '내 입력 수정' : '입력하기'}</button>
            <button data-result="${s.id}">결과 보기</button>
          </div>
        </div>`);
        card.onclick = () => go(`#/s/${s.id}`);
        card.querySelector('[data-input]').onclick = (e) => { e.stopPropagation(); go(`#/s/${s.id}/me${mine ? `?n=${encodeURIComponent(myName)}` : ''}`); };
        card.querySelector('[data-result]').onclick = (e) => { e.stopPropagation(); go(`#/s/${s.id}`); };
        list.appendChild(card);
      }
    }
    // 지난 합주
    if (past.length) {
      list.appendChild(h('<h2>지난 합주</h2>'));
      for (const { s } of past.slice(0, 5)) {
        const c = h(`<div class="card link compact"><div class="row spread"><span>${fmtK(s.confirmed.date)} ${timeText(s.confirmed)}</span><span class="muted">${esc(s.title)}</span></div></div>`);
        c.onclick = () => go(`#/s/${s.id}`);
        list.appendChild(c);
      }
    }
  };
  app.querySelector('#arch').onclick = async () => {
    showArchived = !showArchived;
    app.querySelector('#arch').textContent = showArchived ? '돌아가기' : '보관함 보기';
    render(await store.listSessions());
  };
  unsub = store.subscribeList(render);
}

// ---------- 화면: 새 취합 ----------
function viewNew() {
  if (!isAdmin()) {
    app.innerHTML = `${topbar('새 취합 만들기')}<p class="muted">영파이 비밀번호가 필요해요.</p>`;
    requireAdmin('새 취합 만들기').then((ok) => { if (ok) viewNew(); else go('#/home'); });
    return;
  }
  const today = new Date();
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  const draft = {
    title: `${next.getFullYear()}년 ${next.getMonth() + 1}월 합주`,
    start: formatDate(next), end: formatDate(end), holidays: [],
    memberCount: MEMBER_COUNT,
  };
  app.innerHTML = `${topbar('새 취합 만들기', '#/', '기간과 인원을 정하고 공휴일을 확인해 주세요')}
    <div class="card">
      <label class="field"><span>제목</span><input type="text" id="title"></label>
      <div class="row"><label class="field" style="flex:1"><span>시작일</span><input type="date" id="start"></label>
      <label class="field" style="flex:1"><span>종료일</span><input type="date" id="end"></label></div>
      <label class="field"><span>인원</span><input type="text" id="count" inputmode="numeric"></label>
      <label class="field"><span>공지사항 (선택)</span><textarea id="notice" rows="3" placeholder="예: 이번 달은 합주실 예약 때문에 주말 위주로 잡을게요"></textarea></label>
    </div>
    <h2>공휴일 지정</h2>
    <p class="muted">빨간 날은 주말처럼 9~21시 중에 시간을 고르게 돼요. 날짜를 눌러 켜고 끌 수 있어요.</p>
    <div id="cal"></div>
    <div class="sticky"><div class="inner"><button class="primary" id="save">만들기</button></div></div>`;
  const $ = (id) => app.querySelector('#' + id);
  $('title').value = draft.title; $('start').value = draft.start; $('end').value = draft.end; $('count').value = draft.memberCount;
  const fillHolidays = () => {
    draft.holidays = dateRange(draft.start, draft.end).filter((d) => KR_HOLIDAYS[d] && weekday(d) !== 0 && weekday(d) !== 6);
  };
  const draw = () => renderCalendar($('cal'), draft, {
    cell: (date) => ({ html: draft.holidays.includes(date) ? '<div class="mark">휴일</div>' : '' }),
    onClick: (date) => {
      const w = weekday(date);
      if (w === 0 || w === 6) return toast('주말은 이미 하루 종일 선택 가능해요');
      const i = draft.holidays.indexOf(date);
      if (i >= 0) draft.holidays.splice(i, 1); else draft.holidays.push(date);
      draw();
    },
  });
  fillHolidays(); draw();
  const onRange = () => {
    draft.start = $('start').value; draft.end = $('end').value;
    if (draft.start && draft.end && draft.start <= draft.end) { fillHolidays(); draw(); }
  };
  $('start').onchange = onRange; $('end').onchange = onRange;
  $('save').onclick = async () => {
    draft.title = $('title').value.trim() || draft.title;
    draft.memberCount = Number($('count').value) || MEMBER_COUNT;
    const notice = $('notice').value.trim();
    if (notice) draft.notice = notice;
    if (!draft.start || !draft.end || draft.start > draft.end) return toast('기간을 확인해 주세요');
    draft.holidays.sort();
    const s = await busy($('save'), '만드는 중…', () => safe(store.createSession(draft)));
    go(`#/s/${s.id}`);
  };
}

// ---------- 화면: 결과 ----------
// admin=false: 보기 전용 결과 화면. admin=true: 리더 관리 페이지(확정·확정 취소·공지 수정·보관).
function viewSession(id, admin = false) {
  if (admin && !isAdmin()) {
    app.innerHTML = `${topbar('관리', `#/s/${id}`)}<p class="muted">영파이 비밀번호가 필요해요.</p>`;
    requireAdmin('관리 페이지').then((ok) => { if (ok) viewSession(id, true); else go(`#/s/${id}`); });
    return;
  }
  let session = null, members = {}, mode = 'all', altIndex = 0, selected = null;
  app.innerHTML = `<div id="root"><p class="muted">불러오는 중...</p></div>`;
  const root = app.querySelector('#root');

  const render = () => {
    if (!session) { root.innerHTML = `${topbar('취합')}<p>취합을 찾을 수 없어요.</p>`; return; }
    const count = session.memberCount || MEMBER_COUNT;
    const names = Object.keys(members);
    const full = computeAvailability(session, members);
    const fullDates = availableDates(full);
    const alts = findWithOneExcluded(session, members);
    if (mode === 'alt' && !alts.length) mode = 'all';
    const shown = mode === 'alt' ? alts[Math.min(altIndex, alts.length - 1)].result : full;
    const inputUrl = `${baseUrl()}#/s/${session.id}/me`;
    const myName = localStorage.getItem('band-my-name') || '';
    const mine = myName && members[myName];
    const confirmedText = session.confirmed ? `<b>${fmtK(session.confirmed.date)} ${session.confirmed.start}~${session.confirmed.start + DURATION}시</b>` : '';

    root.innerHTML = `${admin ? topbar(`관리 · ${session.title}`, `#/s/${session.id}`, periodLabel(session)) : topbar(session.title, '#/', periodLabel(session))}
      ${noticeBoard(session, admin)}
      <div class="row spread" style="margin-bottom:var(--space-3)">
        <span class="muted">제출 <b style="color:var(--color-fg)">${names.length}</b>/${count}명${names.length >= count ? ' · 모두 제출' : ''}</span>
        ${admin ? '' : '<button class="small ghost" id="adminBtn">관리</button>'}
      </div>
      ${session.confirmed ? `<div class="notice ok row spread"><span>★ ${confirmedText}로 확정됐어요. 입력이 잠겨 있어요.</span>${admin ? '<button class="small" id="unconfirm">확정 취소</button>' : ''}</div>` : ''}
      ${admin && !session.confirmed ? '<div class="notice">날짜를 누르면 확정할 시간을 고를 수 있어요.</div>' : ''}
      ${!fullDates.length && names.length ? `<div class="notice">전원 가능한 날이 없어요.${alts.length ? ' 아래 스위치를 켜면 한 명 빼고 찾아볼 수 있어요.' : ''}</div>` : ''}
      ${alts.length ? `<div class="row" style="margin:10px 0">
        <label class="switch"><input type="checkbox" id="toggleAlt" ${mode === 'alt' ? 'checked' : ''}><span class="track" aria-hidden="true"></span><span>한 명 빼고 찾기</span></label>
        ${mode === 'alt' ? `<span class="chips" id="altChips"></span>` : ''}
      </div>` : ''}
      <div class="legend"><span><i class="ok"></i>전원 가능</span>${mode === 'alt' ? '<span><i class="alt"></i>한 명 빼면 가능</span>' : ''}<span><i class="none"></i>불가</span>${session.confirmed ? '<span><i class="confirmed"></i>확정</span>' : ''}</div>
      <div id="cal"></div>
      <div id="detail"></div>
      <h2>제출 현황</h2>
      <div class="card band">
        <div class="count"><b>${names.length}</b><span>/ ${count}명</span></div>
        ${progress(names.length, count)}
        <div class="chips" id="names"></div>
        ${names.length ? '<p class="muted">이름을 누르면 그 사람 입력을 수정할 수 있어요.</p>' : '<p class="muted">아직 아무도 입력하지 않았어요. 링크를 보내 주세요.</p>'}
        <div class="actions" style="margin-top:8px">
          ${admin ? '' : mine
            ? `<button id="me" ${session.confirmed ? 'disabled' : ''}>내 입력 수정</button>`
            : `<button class="primary" id="me" ${session.confirmed ? 'disabled' : ''}>내 시간 입력하기</button>`}
          <button id="copy">링크 복사</button>
        </div>
      </div>
      ${commentsPanel(members)}
      ${admin ? `<h2>보관 · 삭제</h2>
      <p class="muted">보관하면 목록에서 숨겨지고 "보관함 보기"에서 다시 볼 수 있어요. 삭제는 되돌릴 수 없어요.</p>
      <div class="row"><button class="ghost" id="archive">${session.archived ? '보관 해제' : '보관하기'}</button><button class="ghost danger" id="delete">취합 삭제</button></div>` : ''}`;

    const namesEl = root.querySelector('#names');
    for (const n of names) {
      const c = h(`<button class="chip ${n === myName ? 'on' : ''}">${n === myName ? '✓ ' : ''}${esc(n)}</button>`);
      c.onclick = () => go(`#/s/${session.id}/me?n=${encodeURIComponent(n)}`);
      namesEl.appendChild(c);
    }
    if (mode === 'alt') {
      const ac = root.querySelector('#altChips');
      alts.forEach((a, i) => {
        const c = h(`<button class="chip ${i === altIndex ? 'on' : ''}">${esc(a.excluded)} 제외 (+${(a.added || a.dates).length}일)</button>`);
        c.onclick = () => { altIndex = i; selected = null; render(); };
        ac.appendChild(c);
      });
    }
    const me = root.querySelector('#me');
    if (me) me.onclick = () => go(`#/s/${session.id}/me${mine ? `?n=${encodeURIComponent(myName)}` : ''}`);
    root.querySelector('#copy').onclick = () => copy(`[${session.title}] 안 되는 시간 입력해 주세요\n${inputUrl}`);
    const ta = root.querySelector('#toggleAlt');
    if (ta) ta.onchange = () => { mode = ta.checked ? 'alt' : 'all'; altIndex = 0; selected = null; render(); };
    const ab = root.querySelector('#adminBtn');
    if (ab) ab.onclick = async () => { if (await requireAdmin('관리 페이지')) go(`#/s/${session.id}/admin`); };
    const un = root.querySelector('#unconfirm');
    if (un) un.onclick = () => safe(store.updateSession(session.id, { confirmed: null }));
    if (admin) bindNoticeEditor(root, session);
    const ar = root.querySelector('#archive');
    if (ar) ar.onclick = () => safe(store.updateSession(session.id, { archived: !session.archived }));
    const del = root.querySelector('#delete');
    if (del) del.onclick = () => confirmSheet(`"${session.title}" 취합을 삭제할까요?`, '멤버들이 입력한 내용도 함께 사라지고 되돌릴 수 없어요.', async () => {
      if (unsub) { unsub(); unsub = null; }
      await safe(store.deleteSession(session.id));
      toast('삭제했어요');
      go('#/home');
    });

    renderCalendar(root.querySelector('#cal'), session, {
      cell: (date) => {
        const r = shown[date];
        const isConfirmed = session.confirmed && session.confirmed.date === date;
        const cls = [r.runs.length ? (mode === 'alt' && !full[date].runs.length ? 'alt' : 'ok') : 'none',
          selected === date ? 'sel' : '', isConfirmed ? 'confirmed' : ''].join(' ');
        const html = r.runs.length ? `<div class="info">${r.runs.map((x) => `${x.start}~${x.end}`).join('<br>')}</div>`
          : names.length ? '<div class="info"><span class="sr">불가</span></div>' : '';
        return { cls, html };
      },
      onClick: (date) => { selected = selected === date ? null : date; render(); },
    });
    if (selected) {
      renderDetail(shown[selected]);
      root.querySelector('#detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  const renderDetail = (r) => {
    const el = root.querySelector('#detail');
    const kind = r.kind;
    const blockersHtml = Object.entries(r.blockers).sort((a, b) => a[0] - b[0])
      .map(([hh, who]) => `<li>${kind === 'evening' ? '19~21시' : hourLabel(Number(hh)) + '시'}: ${who.map(esc).join(', ')}</li>`).join('');
    let confirmHtml = '';
    if (admin && !session.confirmed && r.runs.length) {
      const opts = [];
      for (const run of r.runs) for (let s = run.start; s + DURATION <= run.end; s++) opts.push(s);
      confirmHtml = `<h3>이 날로 확정</h3><div class="chips">${opts.map((s) => `<button class="chip cf" data-s="${s}">${s}~${s + DURATION}시</button>`).join('')}</div>`;
    }
    el.innerHTML = `<div class="card detail">
      <b>${fmtK(r.date)}</b> <span class="muted">${kind === 'evening' ? '평일 19~21시' : '9~21시'}</span>
      <p>${r.runs.length ? '가능: ' + r.runs.map(formatRun).join(', ') : '가능한 시간 없음'}</p>
      ${blockersHtml ? `<p class="muted">안 되는 멤버</p><ul style="margin:0;padding-left:18px">${blockersHtml}</ul>` : '<p class="muted">이 날은 모두 가능해요</p>'}
      ${confirmHtml}
    </div>`;
    el.querySelectorAll('.cf').forEach((b) => b.onclick = async (e) => {
      const start = Number(b.dataset.s);
      if (!isAdmin()) return;
      starBurst(e.clientX, e.clientY);
      await busy(b, '확정 중…', () => safe(store.updateSession(session.id, { confirmed: { date: r.date, start } })));
    });
  };

  unsub = store.subscribe(id, (d) => { session = d.session; members = d.members || {}; render(); });
}

// ---------- 화면: 입력 ----------
function viewInput(id, query) {
  let session = null, members = {};
  let name = query.get('n') || localStorage.getItem('band-my-name') || '';
  let data = null; // { unavailable: {...} }
  let started = false, done = false;
  app.innerHTML = `<div id="root"><p class="muted">불러오는 중...</p></div>`;
  const root = app.querySelector('#root');
  const steps = (cur) => `<ol class="steps" aria-label="진행 단계">${['이름', '안 되는 시간', '완료'].map((t, i) => `<li class="${i + 1 < cur ? 'past' : i + 1 === cur ? 'cur' : ''}" ${i + 1 === cur ? 'aria-current="step"' : ''}><i>${i + 1}</i>${t}</li>`).join('')}</ol>`;

  const renderNameStep = async () => {
    const known = await store.knownNames();
    root.innerHTML = `${topbar(session.title, `#/s/${session.id}`, periodLabel(session))}
      ${steps(1)}
      ${noticeBoard(session)}
      <div class="card">
        <h3 style="margin-top:0">누구의 시간인가요?</h3>
        <label class="field"><span>이름</span><input type="text" id="name" placeholder="이름을 입력해 주세요" autocomplete="nickname"></label>
        ${known.length ? `<p class="muted">멤버 이름 고르기</p><div class="chips" id="known"></div>` : ''}
        <button class="primary wide" id="start" style="margin-top:8px">다음</button>
      </div>`;
    const input = root.querySelector('#name'); input.value = name;
    const kn = root.querySelector('#known');
    if (kn) for (const k of known) { const c = h(`<button class="chip">${esc(k)}</button>`); c.onclick = () => { input.value = k; }; kn.appendChild(c); }
    root.querySelector('#start').onclick = () => {
      name = input.value.trim();
      if (!name) return toast('이름을 입력해 주세요');
      if (BAD_NAME.test(name)) return toast('이름에 . # $ [ ] / 는 쓸 수 없어요');
      if (name.length > 20) return toast('이름은 20자 이내로 입력해 주세요');
      localStorage.setItem('band-my-name', name);
      data = JSON.parse(JSON.stringify(members[name] || { unavailable: {} }));
      data.unavailable = data.unavailable || {};
      data.comment = data.comment || '';
      started = true; renderGrid();
    };
  };

  const renderGrid = () => {
    root.innerHTML = `${topbar(`${name}의 안 되는 시간`, `#/s/${session.id}`, periodLabel(session))}
      ${steps(2)}
      ${noticeBoard(session)}
      <div class="notice">• 기본은 <b>가능</b><br> • <b>안 되는 날/시간만</b> 표시<br>
      • 평일은 한 번 누르면 그날 불가<br> • 주말·공휴일은 안되는 시간까지!</div>
      <div class="legend"><span><i class="free"></i>가능</span><span><i class="na"></i>불가</span><span><i class="partial"></i>일부 불가</span></div>
      <div id="cal"></div>
      <label class="field"><span>한마디 (선택, 최대 100자)</span><textarea id="comment" rows="2" maxlength="100" placeholder="예: 이번 주말엔 늦게 도착해요"></textarea></label>
      <div class="sticky"><div class="inner"><button id="clear">모두 지우기</button><button class="primary" id="save">저장</button></div></div>`;
    const draw = () => renderCalendar(root.querySelector('#cal'), session, {
      cell: (date, kind) => {
        const u = data.unavailable[date];
        if (u === 'all') return { cls: 'na', html: '<div class="mark">불가</div>' };
        if (Array.isArray(u) && u.length) return { cls: 'partial', html: `<div class="mark">${u.length}시간 불가</div>` };
        return { html: kind === 'evening' ? '<div class="info muted">19~21</div>' : '<div class="info muted">9~21</div>' };
      },
      onClick: (date, kind) => {
        if (kind === 'evening') {
          if (data.unavailable[date] === 'all') delete data.unavailable[date]; else data.unavailable[date] = 'all';
          draw();
        } else openHourSheet(date, draw);
      },
    });
    draw();
    root.querySelector('#comment').value = data.comment || '';
    root.querySelector('#clear').onclick = () => { data.unavailable = {}; draw(); };
    root.querySelector('#save').onclick = async (e) => {
      if (session.confirmed) { toast('이미 확정되어 저장할 수 없어요'); return go(`#/s/${session.id}`); }
      data.comment = root.querySelector('#comment').value.trim();
      await busy(e.currentTarget, '저장 중…', () => safe(store.setMember(session.id, name, data)));
      done = true; renderDone();
    };
  };

  const renderDone = () => {
    const total = session.memberCount || MEMBER_COUNT;
    const n = Object.keys(members).length;
    const blocked = Object.keys(data.unavailable).length;
    root.innerHTML = `${topbar('입력 완료', `#/s/${session.id}`, session.title)}
      ${steps(3)}
      <div class="card band done">
        <div class="muted" style="font-weight:600">고마워요, ${esc(name)}</div>
        <div class="count"><b>${n}</b><span>/ ${total}명 모였어요</span></div>
        ${progress(n, total)}
        <p class="muted">${blocked ? `안 되는 날 ${blocked}일을 표시했어요.` : '모든 날이 가능하다고 표시했어요.'} ${n >= total ? '모두 모였으니 리더가 날짜를 확정할 거예요.' : `아직 ${total - n}명이 남았어요.`}</p>
        <div class="row" style="margin-top:8px">
          <button class="primary" id="toResult">결과 보기</button>
          <button id="edit">다시 수정</button>
        </div>
      </div>`;
    root.querySelector('#toResult').onclick = () => go(`#/s/${session.id}`);
    root.querySelector('#edit').onclick = () => { done = false; renderGrid(); };
  };

  const openHourSheet = (date, onClose) => {
    const hours = slotsFor('day');
    let set = new Set(data.unavailable[date] === 'all' ? hours : (data.unavailable[date] || []));
    const bg = h('<div class="sheet-bg"></div>');
    const sheet = h(`<div class="sheet">
      <div class="row spread"><b>${fmtK(date)} 안 되는 시간</b><button class="small" id="allday">하루 종일 불가</button></div>
      <p class="muted">누르거나 드래그해서 표시해 주세요. 흰색은 가능, 빨간색은 안 되는 시간이에요.</p>
      <div class="hours" id="hours"></div>
      <div class="row"><button style="flex:1" id="none">전부 가능</button><button class="primary" style="flex:1" id="done">완료</button></div>
    </div>`);
    const grid = sheet.querySelector('#hours');
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', '시간대. Enter 또는 Space로 불가 표시 전환');
    const drawHours = () => {
      grid.innerHTML = '';
      for (const hh of hours) grid.appendChild(h(`<div class="hour ${set.has(hh) ? 'na' : ''}" data-h="${hh}" tabindex="0" role="checkbox" aria-checked="${set.has(hh)}" aria-label="${hourLabel(hh)}시 불가">${hourLabel(hh)}</div>`));
    };
    drawHours();
    let painting = null;
    const cellAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.classList.contains('hour') ? el : null; };
    const apply = (el) => { const hh = Number(el.dataset.h); if (painting) set.add(hh); else set.delete(hh); el.classList.toggle('na', painting); el.setAttribute('aria-checked', String(painting)); };
    grid.addEventListener('pointerdown', (e) => { const c = cellAt(e.clientX, e.clientY); if (!c) return; painting = !set.has(Number(c.dataset.h)); apply(c); });
    grid.addEventListener('pointermove', (e) => { if (painting === null) return; const c = cellAt(e.clientX, e.clientY); if (c) apply(c); });
    grid.addEventListener('keydown', (e) => {
      const c = e.target.closest('.hour'); if (!c) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); painting = !set.has(Number(c.dataset.h)); apply(c); painting = null; }
    });
    const stop = () => { painting = null; };
    window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
    const close = mountSheet(bg, sheet, () => {
      window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop);
      const arr = hours.filter((hh) => set.has(hh));
      if (arr.length === hours.length) data.unavailable[date] = 'all';
      else if (arr.length) data.unavailable[date] = arr;
      else delete data.unavailable[date];
      onClose();
    }, `${fmtK(date)} 안 되는 시간 고르기`);
    sheet.querySelector('#allday').onclick = () => { set = new Set(hours); drawHours(); };
    sheet.querySelector('#none').onclick = () => { set = new Set(); drawHours(); };
    sheet.querySelector('#done').onclick = () => close();
  };

  unsub = store.subscribe(id, (d) => {
    session = d.session; members = d.members || {};
    if (!session) { root.innerHTML = `${topbar('입력')}<p>취합을 찾을 수 없어요.</p>`; return; }
    if (session.confirmed) { root.innerHTML = `${topbar(session.title, `#/s/${session.id}`)}<div class="notice ok">이미 <b>${fmtK(session.confirmed.date)} ${session.confirmed.start}시</b>로 확정되어 입력이 잠겨 있어요.</div>`; return; }
    if (done) renderDone();
    else if (!started) renderNameStep();
  });
}

// ---------- 라우터 ----------
function route() {
  if (unsub) { unsub(); unsub = null; }
  document.documentElement.classList.remove('is-intro');
  document.querySelectorAll('.sheet, .sheet-bg').forEach((e) => e.remove());
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const query = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  window.scrollTo(0, 0);
  if (parts[0] === 'new') return viewNew();
  if (parts[0] === 'home') return viewList();
  if (!parts.length) return viewIntro();
  if (parts[0] === 's' && parts[1] && parts[2] === 'me') return viewInput(parts[1], query);
  if (parts[0] === 's' && parts[1] && parts[2] === 'admin') return viewSession(parts[1], true);
  if (parts[0] === 's' && parts[1]) return viewSession(parts[1]);
  return viewList();
}
window.addEventListener('hashchange', route);
route();
