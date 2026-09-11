// 저장소 계층. LocalStore(브라우저 localStorage)와 FirebaseStore(Realtime Database)가
// 같은 인터페이스를 가진다.
//
//   listSessions()                      -> [session]
//   getSession(id)                      -> session | null
//   createSession(data)                 -> session
//   updateSession(id, patch)            -> void
//   getMembers(id)                      -> { [name]: memberData }
//   setMember(id, name, data)           -> void
//   subscribe(id, cb)                   -> unsubscribe()   cb({session, members})
//   subscribeList(cb)                   -> unsubscribe()   cb([session])
//   knownNames()                        -> [name]  (이전 취합에서 쓰인 이름)

function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

// ---------- LocalStore ----------
export class LocalStore {
  constructor(key = 'band-schedule') {
    this.key = key;
    this.listeners = new Set();
    window.addEventListener('storage', (e) => { if (e.key === this.key) this.notify(); });
  }
  load() {
    try { return JSON.parse(localStorage.getItem(this.key)) || { sessions: {}, members: {} }; }
    catch { return { sessions: {}, members: {} }; }
  }
  save(db) { localStorage.setItem(this.key, JSON.stringify(db)); this.notify(); }
  notify() { for (const l of this.listeners) l(); }

  async listSessions() {
    return Object.values(this.load().sessions).sort((a, b) => b.createdAt - a.createdAt);
  }
  async getSession(id) { return this.load().sessions[id] || null; }
  async createSession(data) {
    const db = this.load();
    const s = { ...data, id: uid(), createdAt: Date.now() };
    db.sessions[s.id] = s;
    this.save(db);
    return s;
  }
  async updateSession(id, patch) {
    const db = this.load();
    db.sessions[id] = { ...db.sessions[id], ...patch };
    this.save(db);
  }
  async deleteSession(id) {
    const db = this.load();
    delete db.sessions[id]; delete db.members[id];
    this.save(db);
  }
  async getMembers(id) { return this.load().members[id] || {}; }
  async setMember(id, name, data) {
    const db = this.load();
    db.members[id] = db.members[id] || {};
    db.members[id][name] = { ...data, updatedAt: Date.now() };
    this.save(db);
  }
  subscribe(id, cb) {
    const fire = async () => cb({ session: await this.getSession(id), members: await this.getMembers(id) });
    this.listeners.add(fire); fire();
    return () => this.listeners.delete(fire);
  }
  subscribeList(cb) {
    const fire = async () => cb(await this.listSessions());
    this.listeners.add(fire); fire();
    return () => this.listeners.delete(fire);
  }
  async knownNames() {
    const names = new Set();
    for (const m of Object.values(this.load().members)) for (const n of Object.keys(m)) names.add(n);
    return [...names];
  }
}

// ---------- FirebaseStore ----------
// Firebase compat SDK를 동적으로 불러온다. 데이터 구조:
//   sessions/{id}            세션
//   members/{id}/{name}      멤버 입력
export class FirebaseStore {
  constructor(config) { this.config = config; this.ready = this.init(); }
  async init() {
    const load = (src) => new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    try {
      await load('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
      await load('https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js');
    } catch (e) {
      throw new Error('Firebase SDK를 불러오지 못했습니다');
    }
    window.firebase.initializeApp(this.config);
    this.db = window.firebase.database();
  }
  async listSessions() {
    await this.ready;
    const snap = await this.db.ref('sessions').get();
    return Object.values(snap.val() || {}).sort((a, b) => b.createdAt - a.createdAt);
  }
  async getSession(id) {
    await this.ready;
    return (await this.db.ref(`sessions/${id}`).get()).val();
  }
  async createSession(data) {
    await this.ready;
    const s = { ...data, id: uid(), createdAt: Date.now() };
    await this.db.ref(`sessions/${s.id}`).set(s);
    return s;
  }
  async updateSession(id, patch) {
    await this.ready;
    await this.db.ref(`sessions/${id}`).update(patch);
  }
  // 취합을 지운 뒤 멤버 입력 기록도 지운다 (규칙: 취합이 없는 경우에만 멤버 기록 삭제 허용).
  async deleteSession(id) {
    await this.ready;
    await this.db.ref(`sessions/${id}`).remove();
    try { await this.db.ref(`members/${id}`).remove(); } catch (e) { console.warn('멤버 기록 삭제 실패(규칙 미적용?)', e); }
  }
  async getMembers(id) {
    await this.ready;
    return (await this.db.ref(`members/${id}`).get()).val() || {};
  }
  async setMember(id, name, data) {
    await this.ready;
    await this.db.ref(`members/${id}/${name}`).set({ ...data, updatedAt: Date.now() });
  }
  subscribe(id, cb) {
    let session = null, members = {}, gotSession = false;
    let sRef, mRef;
    this.ready.then(() => {
      sRef = this.db.ref(`sessions/${id}`);
      mRef = this.db.ref(`members/${id}`);
      // 취합 데이터가 도착하기 전에는 알리지 않는다 (멤버가 먼저 오면 "없음"으로 잘못 그려짐)
      sRef.on('value', (s) => { session = s.val(); gotSession = true; cb({ session, members }); });
      mRef.on('value', (s) => { members = s.val() || {}; if (gotSession) cb({ session, members }); });
    });
    return () => { sRef && sRef.off(); mRef && mRef.off(); };
  }
  subscribeList(cb) {
    let ref;
    this.ready.then(() => {
      ref = this.db.ref('sessions');
      ref.on('value', (s) => cb(Object.values(s.val() || {}).sort((a, b) => b.createdAt - a.createdAt)));
    });
    return () => ref && ref.off();
  }
  // 현재 존재하는 취합의 멤버 이름만 모은다 (지워진 취합에 남은 기록은 무시).
  async knownNames() {
    await this.ready;
    const [sessions, all] = await Promise.all([
      this.db.ref('sessions').get().then((s) => s.val() || {}),
      this.db.ref('members').get().then((s) => s.val() || {}),
    ]);
    const names = new Set();
    for (const id of Object.keys(all)) {
      if (!sessions[id]) continue;
      for (const n of Object.keys(all[id])) names.add(n);
    }
    return [...names];
  }
}

export function createStore(firebaseConfig) {
  return firebaseConfig ? new FirebaseStore(firebaseConfig) : new LocalStore();
}
