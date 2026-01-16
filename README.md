# KPolitics 백엔드 API

한국 정치인 정보 웹사이트의 백엔드 API 서버입니다.

## 기술 스택

- **Node.js** (Express.js) - 백엔드 프레임워크
- **TypeScript** - 타입 안전성
- **MongoDB** - 데이터베이스
- **Puppeteer** - 웹 스크래핑 (국회의원 공약 크롤링)
- **bcrypt** - 비밀번호 해싱
- **express-rate-limit** - API Rate Limiting
- **sanitize-html** - XSS 방지

## 주요 기능

### 1. 국회의원 정보 API
- 국회 Open API 연동
- 국회의원 목록 조회 (지역별 필터링)
- 국회의원 상세 정보 (법안, 공약 포함)

### 2. 단체장 정보 API
- 광역 단체장 정보 조회
- 기초 단체장 정보 조회
- 역대 단체장 조회
- 공약 데이터 크롤링 및 캐싱

### 3. 게시판 API
- 게시글 CRUD (작성, 조회, 수정, 삭제)
- 댓글 CRUD
- 비밀번호 기반 인증
- 관리자 권한 기능
- 페이지네이션

### 4. 정치성향 테스트 API
- 24개 문항 조회
- 카테고리별 테스트 (경제, 사회, 정부 역할, 안보)

## 환경 변수 설정

`.env` 파일을 생성하고 다음 변수를 설정하세요:

```env
# MongoDB 연결 문자열
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/kpolitics

# 국회 Open API 키 (https://open.assembly.go.kr/portal/openapi/main.do)
ASSEMBLY_API_KEY=your_api_key_here

# 프론트엔드 도메인 (CORS 허용)
FRONTEND_URL=https://www.kpolitics.co.kr,https://kpolitics.vercel.app

# 관리자 비밀번호 (bcrypt 해시값)
ADMIN_PASSWORD=hashed_password_here

# 서버 포트 (기본값: 4001)
PORT=4001

# 환경 모드
NODE_ENV=production
```

## 로컬 실행 방법

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경 변수 설정
`.env` 파일 생성 후 위 환경 변수 설정

### 3. 개발 서버 실행
```bash
npm run dev
```
서버가 `http://localhost:4001`에서 실행됩니다.

### 4. 프로덕션 빌드
```bash
npm run build
npm start
```

## API 엔드포인트

### 헬스체크
- `GET /healthz` - 서버 상태 및 MongoDB 연결 확인

### 국회의원
- `GET /api/assembly/members` - 국회의원 목록 조회 (?region=지역명)
- `GET /api/assembly/member/:name` - 국회의원 상세 정보

### 단체장
- `GET /api/governors/metropolitan` - 광역 단체장 목록 (?region=지역명)
- `GET /api/governors/basic` - 기초 단체장 목록 (?metro=광역시도명)
- `GET /api/governors/previous/:region` - 역대 단체장 (?isBasic=true/false)
- `GET /api/governors/pledges/:name` - 단체장 공약 조회

### 게시판
- `GET /api/board/posts` - 게시글 목록 (?page=1&limit=15)
- `GET /api/board/posts/:id` - 게시글 상세 조회
- `POST /api/board/posts` - 게시글 작성
- `PATCH /api/board/posts/:id` - 게시글 수정
- `DELETE /api/board/posts/:id` - 게시글 삭제
- `POST /api/board/verify-password` - 비밀번호 확인

### 댓글
- `GET /api/board/posts/:postId/comments` - 댓글 목록
- `POST /api/board/posts/:postId/comments` - 댓글 작성
- `PATCH /api/board/comments/:id` - 댓글 수정
- `DELETE /api/board/posts/:id/comments/:commentId` - 댓글 삭제

### 정치성향 테스트
- `GET /api/political-test/questions` - 테스트 문항 전체 조회

## 보안 기능

### 1. Rate Limiting
- **POST 요청**: 1분당 5회 제한 (게시글/댓글 작성)
- **GET 요청**: 1분당 100회 제한 (크롤링/스크래핑 방지)

### 2. XSS 방지
- `sanitize-html`을 사용한 입력 새니타이제이션
- 게시글 제목, 내용, 닉네임, 댓글 모두 필터링

### 3. CORS 설정
- 명시적으로 허용된 도메인만 접근 가능
- 와일드카드 패턴 사용 안 함

### 4. 비밀번호 해싱
- bcrypt를 사용한 관리자 비밀번호 해싱
- 게시글/댓글 비밀번호 bcrypt 해싱 (salt rounds: 10)

### 5. 에러 메시지 보안
- 프로덕션 환경에서는 상세 에러 정보 숨김
- 개발 환경에서만 스택 트레이스 노출

## MongoDB 컬렉션 구조

### assemblyMembers
국회의원 정보 (국회 Open API 캐시)

### metropolitanGovernors
광역 단체장 정보

### basicGovernors
기초 단체장 정보

### posts
게시판 게시글
```typescript
{
  title: string;
  content: string;
  nickname: string;
  password: string; // bcrypt 해시
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
  isDeleted: boolean;
}
```

### comments
게시판 댓글
```typescript
{
  postId: ObjectId;
  content: string;
  nickname: string;
  password: string; // bcrypt 해시
  createdAt: Date;
  updatedAt: Date;
  isDeleted: boolean;
}
```

### pledges
단체장 공약 데이터 캐시

### questions
정치성향 테스트 문항

## 배포 (Render)

### 1. Render 설정
- **Environment**: Node
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`

### 2. 환경 변수 설정
Render 대시보드에서 위의 모든 환경 변수 설정

### 3. 자동 배포
GitHub에 푸시하면 자동으로 배포됩니다.

## Cron Job

매일 새벽 3시에 국회의원 정보를 자동으로 갱신합니다.

```typescript
// 매일 03:00 (KST)
cron.schedule("0 18 * * *", async () => {
  console.log("🔄 [Cron] 국회의원 정보 자동 갱신 시작");
  await refreshAssemblyMembers();
});
```

## 주의사항

1. **API 키 보안**: 환경 변수를 GitHub에 커밋하지 마세요.
2. **관리자 비밀번호**: 반드시 bcrypt 해시값을 사용하세요.
3. **Rate Limiting**: 프로덕션 환경에서 적절한 제한값으로 조정하세요.
4. **MongoDB 인덱스**: 쿼리 성능을 위해 인덱스를 설정하세요.

## 라이선스

MIT
