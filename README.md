# 영파이 합주 시간 취합

영파이 멤버들이 **안 되는 날짜/시간**만 표시하면, 전원이 가능한 합주 시간을 달력에서 바로 보여주는 웹앱입니다.
GitHub Pages(정적 호스팅) + Firebase Realtime Database(무료)로 동작하며 서버 코드가 없습니다.

## 규칙

- 합주는 **2시간** 고정.
- 평일: 19~21시 한 슬롯. 되냐/안 되냐만 표시.
- 토/일/공휴일: 9~21시를 1시간 단위로 나눠 안 되는 시간을 칠함.
- 결과: 전원이 비어 있는 시간이 2시간 이상 이어지는 구간을 날짜별로 표시.
- 전원 가능한 날이 없으면 "한 명 빼고 찾기" 버튼으로 한 명씩 제외한 결과를 볼 수 있음.
- 확정하면 입력이 잠기고, 확정 취소도 가능.

## 파일 구성

```
index.html            진입 페이지
style.css             화면 스타일 (tokens.css의 토큰만 참조)
tokens.css            색·폰트·간격·모션 토큰 (Hallmark Hum 테마)
design.md             잠긴 디자인 시스템. 화면을 추가하거나 고칠 때 먼저 읽을 것
js/app.js             화면(목록 / 새 취합 / 결과 달력 / 입력 달력 + 시간 격자)
js/scheduler.js       가능 시간 계산 (순수 함수)
js/store.js           저장소 (localStorage 또는 Firebase)
js/holidays.js        공휴일 기본 목록 (2026~2027)
js/config.js          Firebase 설정, 밴드 이름, 기본 인원
database.rules.json   Firebase 보안 규칙
test/                 계산 로직 테스트, 개발용 샘플 데이터(seed.html)
```

## 로컬에서 실행

```
npm test                       # 계산 로직 테스트
python -m http.server 8080     # 또는 아무 정적 서버
```
브라우저에서 http://localhost:8080 을 엽니다. `js/config.js`의 `firebaseConfig`가 `null`이면
브라우저 로컬 저장 모드로 동작합니다(공유 안 됨). 샘플 데이터는 http://localhost:8080/test/seed.html 로 심을 수 있습니다.

## Firebase 연결 (한 번만)

1. https://console.firebase.google.com 에서 프로젝트 만들기 (Google 애널리틱스는 꺼도 됨).
2. 왼쪽 메뉴 **빌드 > Realtime Database > 데이터베이스 만들기**. 위치는 아무 곳, 보안 규칙은 "잠금 모드"로 시작.
3. **규칙** 탭에 `database.rules.json` 내용을 붙여넣고 게시.
4. 프로젝트 개요 옆 톱니 > **프로젝트 설정 > 일반 > 내 앱 > 웹 앱 추가(</>)**. 호스팅은 체크하지 않음.
5. 표시되는 `firebaseConfig` 값을 `js/config.js`에 붙여넣기. `databaseURL`이 없으면 Realtime Database 화면 상단의 주소를 넣습니다.
6. `BAND_NAME`, `MEMBER_COUNT`도 원하는 값으로 수정.

## GitHub Pages 배포

1. GitHub에 새 저장소 만들기 (예: `band-schedule`, Public).
2. 이 폴더에서:
   ```
   git init
   git add .
   git commit -m "합주 시간 취합 앱"
   git branch -M main
   git remote add origin https://github.com/<아이디>/band-schedule.git
   git push -u origin main
   ```
3. 저장소 **Settings > Pages > Build and deployment**: Source = "Deploy from a branch", Branch = `main`, 폴더 = `/ (root)`, Save.
4. 1~2분 뒤 `https://<아이디>.github.io/band-schedule/` 에서 열립니다. 이 주소를 멤버들에게 공유하면 됩니다.

코드 수정 후에는 `git add . && git commit -m "..." && git push` 만 하면 자동으로 다시 배포됩니다.
취합을 새로 만드는 것은 앱 안에서 하며, 배포와 무관합니다.

## 리더 비밀번호

"새 취합 만들기"와 결과 화면 우상단의 "관리" 버튼은 리더 비밀번호를 물어봅니다. 관리 페이지에서 확정, 확정 취소, 공지 수정, 보관을 합니다. 한 번 맞히면 그 탭을 닫기 전까지 다시 묻지 않습니다.
비밀번호는 `js/config.js`의 `ADMIN_PASSWORD_HASH`에 SHA-256 해시로 들어 있습니다. 바꾸려면:

```
node -e "console.log(require('crypto').createHash('sha256').update('새비밀번호').digest('hex'))"
```

출력된 값을 `ADMIN_PASSWORD_HASH`에 붙여넣고 푸시합니다. `null`로 두면 비밀번호 없이 동작합니다.

이 검사는 브라우저 안에서 이루어지므로, 실수나 장난을 막는 용도이지 보안 장치는 아닙니다.

## 공휴일

`js/holidays.js`에 2026~2027년 공휴일이 들어 있고, 취합을 만들 때 기간 안의 평일 공휴일이 자동으로 빨간 날로 잡힙니다.
달력에서 날짜를 눌러 켜고 끌 수 있으므로 목록이 틀리거나 임시공휴일이 생겨도 앱에서 바로 고칠 수 있습니다.
음력 명절(설날, 추석)은 해마다 정부 공고를 확인하세요.
