// Firebase 설정. null이면 브라우저 로컬 저장(localStorage)으로 동작한다.
// Firebase 콘솔 > 프로젝트 설정 > 웹 앱 에서 받은 값을 아래 형태로 넣는다.
// export const firebaseConfig = {
//   apiKey: '...',
//   authDomain: '....firebaseapp.com',
//   databaseURL: 'https://....firebasedatabase.app',
//   projectId: '...',
//   storageBucket: '....appspot.com',
//   messagingSenderId: '...',
//   appId: '...',
// };
export const firebaseConfig = {
  apiKey: 'AIzaSyCdI6fdk5On97JSpUCBphMY9WLgD1rQ6zQ',
  authDomain: 'youngpie-schedule.firebaseapp.com',
  databaseURL: 'https://youngpie-schedule-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'youngpie-schedule',
  storageBucket: 'youngpie-schedule.firebasestorage.app',
  messagingSenderId: '56762997460',
  appId: '1:56762997460:web:d8f844599fb446f8f5f941',
};

export const BAND_NAME = '영파이';

// 리더 비밀번호의 SHA-256 해시. "새 취합 만들기"와 "확정/확정 취소"에 필요하다.
// 바꾸려면 아래 명령의 결과를 여기에 붙여넣는다.
//   node -e "console.log(require('crypto').createHash('sha256').update('새비밀번호').digest('hex'))"
// null이면 비밀번호 없이 동작한다.
export const ADMIN_PASSWORD_HASH = '296534609ba3ceeae31551b066c3883778dc042c0f68af99d5ddf2354d4d5c72';
export const MEMBER_COUNT = 5;
