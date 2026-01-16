import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import cron from "node-cron";
import puppeteer from "puppeteer";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { seedQuestionsData } from "./scripts/seedQuestions";

dotenv.config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
const app = express();

// CORS 설정 - Vercel 프론트엔드 도메인 허용
// const allowedOrigins = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(",") : ["http://localhost:3000"];

// const isDevelopment = process.env.NODE_ENV !== "production";

const allowedOrigins = [
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(",") : []),
  "https://www.kpolitics.co.kr",
  "https://kpolitics.co.kr",
  "https://kpolitics.vercel.app",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Postman, server-to-server 허용
      if (!origin) return callback(null, true);

      // 정확 일치
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Vercel preview 도메인 허용
      if (origin.endsWith(".vercel.app")) {
        return callback(null, true);
      }

      return callback(new Error("CORS 정책에 의해 차단되었습니다"));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json()); // JSON 파싱

app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

// 게시글/댓글 작성 속도 제한 (1분당 5회)
const postLimiter = rateLimit({
  windowMs: 60 * 1000, // 1분
  max: 5, // 최대 5회
  message: { error: "게시글/댓글 작성이 너무 빈번합니다. 잠시 후 다시 시도해주세요." },
  standardHeaders: true, // Rate limit 정보를 `RateLimit-*` 헤더에 포함
  legacyHeaders: false, // `X-RateLimit-*` 헤더 비활성화
});

let assemblyMembersCollection;
let metropolitanGovernorsCollection;
let basicGovernorsCollection;
let postsCollection;
let commentsCollection;
let billsCollection;
let pledgesCollection;
let winnersCollection; // 당선인 정보 캐시
let questionsCollection; // 정치성향 테스트 문항

// 정치성향 테스트 문항 캐시
let cachedQuestions: any[] | null = null;
let lastQuestionsCacheTime: number | null = null;
const QUESTIONS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24시간

// Function to fetch assembly members from API and cache in MongoDB
async function fetchAndCacheMembers() {
  const SERVICE_KEY = process.env.VITE_ASSEMBLY_API_KEY;
  const BASE_URL = "https://open.assembly.go.kr/portal/openapi/nwvrqwxyaytdsfvhu";

  const url = `${BASE_URL}?Key=${encodeURIComponent(SERVICE_KEY)}&Type=json&pIndex=1&pSize=300`;
  const res = await fetch(url);
  const json = await res.json();
  const rows = json?.nwvrqwxyaytdsfvhu?.[1]?.row;

  if (!Array.isArray(rows)) {
    throw new Error("Invalid API response");
  }

  const members = rows.map((row) => ({
    HG_NM: row.HG_NM, // 한글명
    POLY_NM: row.POLY_NM, // 정당명
    ORIG_NM: row.ORIG_NM, // 지역구명 (예: "서울 강남구갑", "비례대표")
  }));

  await assemblyMembersCollection.updateOne({ _id: "current" }, { $set: { members, lastUpdated: new Date() } }, { upsert: true });

  console.log(`✅ Cached ${members.length} current assembly members`);
}

// 발의법률안 데이터 캐싱
async function fetchAndCacheBills() {
  try {
    const apiKey = process.env.VITE_ASSEMBLY_API_KEY;
    const maxPages = 100;
    const pageSize = 1000;
    let allBills: any[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const billsUrl = `https://open.assembly.go.kr/portal/openapi/nzmimeepazxkubdpn?Key=${apiKey}&Type=json&pIndex=${page}&pSize=${pageSize}&AGE=22`;

      const res = await fetch(billsUrl);
      if (res.ok) {
        const data = await res.json();
        if (data && data.nzmimeepazxkubdpn) {
          let bills: any[] = [];
          if (Array.isArray(data.nzmimeepazxkubdpn) && data.nzmimeepazxkubdpn[1]) {
            const rows = data.nzmimeepazxkubdpn[1].row;
            bills = Array.isArray(rows) ? rows : rows ? [rows] : [];
          } else if (data.nzmimeepazxkubdpn.row) {
            const rows = data.nzmimeepazxkubdpn.row;
            bills = Array.isArray(rows) ? rows : [rows];
          }

          allBills = allBills.concat(bills);

          // 더 이상 데이터가 없으면 중단
          if (bills.length < pageSize) {
            break;
          }
        }
      }
    }

    // MongoDB에 저장
    await billsCollection.updateOne({ _id: "current" }, { $set: { bills: allBills, lastUpdated: new Date() } }, { upsert: true });

    console.log(`✅ 발의법률안 ${allBills.length}건 캐싱 완료`);
  } catch (err) {
    console.error("❌ 발의법률안 캐싱 실패:", err);
  }
}

// 당선인 정보 조회 (2022년 지방선거) - 캐싱 지원
async function fetchWinnerInfo(sgTypecode: string) {
  try {
    const cacheId = sgTypecode === "3" ? "2022-metro" : "2022-basic";
    const electionType = sgTypecode === "3" ? "광역단체장" : "기초단체장";

    // 1. 캐시 확인
    const cached = await winnersCollection.findOne({ _id: cacheId });
    if (cached && cached.winners && cached.winners.length > 0) {
      return cached.winners;
    }

    // 2. 캐시 없으면 API 호출
    const apiKey = process.env.VITE_DATAGO_API_KEY;
    const sgId = "20220601"; // 2022년 지방선거
    const numOfRows = 100;
    let allItems: any[] = [];
    let pageNo = 1;
    const maxPages = 10; // 최대 10페이지 (1000명)

    while (pageNo <= maxPages) {
      const url = `http://apis.data.go.kr/9760000/WinnerInfoInqireService2/getWinnerInfoInqire?serviceKey=${encodeURIComponent(
        apiKey
      )}&sgId=${sgId}&sgTypecode=${sgTypecode}&numOfRows=${numOfRows}&pageNo=${pageNo}&resultType=json`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API 호출 실패: ${response.status}`);
      }

      const text = await response.text();
      const data = JSON.parse(text);

      let items = [];
      if (data.response?.body?.items?.item) {
        items = Array.isArray(data.response.body.items.item) ? data.response.body.items.item : [data.response.body.items.item];
      }

      if (items.length === 0) {
        break; // 더 이상 데이터가 없으면 중단
      }

      allItems = allItems.concat(items);

      if (items.length < numOfRows) {
        break; // 마지막 페이지
      }

      pageNo++;
    }

    // 3. MongoDB에 캐싱
    if (allItems.length > 0) {
      await winnersCollection.updateOne(
        { _id: cacheId },
        {
          $set: {
            winners: allItems,
            cachedAt: new Date(),
            sgTypecode: sgTypecode,
            electionType: electionType,
          },
        },
        { upsert: true }
      );
    }

    return allItems;
  } catch (error: any) {
    console.error("❌ 당선인 정보 조회 실패:", error.message);
    return [];
  }
}

// 대행자와 전임 당선인 매칭
async function matchActingGovernorsWithWinners(governors: any[], isBasic: boolean = false) {
  try {
    // 대행 중인 단체장만 필터링 (status, notes, 또는 이름에 "대행" 포함)
    const actingGovernors = governors.filter(
      (g) => g.status === "권한대행" || g.notes?.includes("권한대행") || g.notes?.includes("직무대행") || g.name?.includes("(대행)")
    );

    if (actingGovernors.length === 0) {
      return governors;
    }

    // 당선인 정보 조회
    const sgTypecode = isBasic ? "4" : "3"; // 3: 광역단체장, 4: 기초단체장
    const winners = await fetchWinnerInfo(sgTypecode);

    if (winners.length === 0) {
      return governors;
    }

    // 각 단체장에 대해 전임자 매칭
    const updatedGovernors = governors.map((governor) => {
      const isActing =
        governor.status === "권한대행" || governor.notes?.includes("권한대행") || governor.notes?.includes("직무대행") || governor.name?.includes("(대행)");

      if (!isActing) {
        return governor;
      }

      // 지역명으로 당선인 찾기
      const region = governor.metropolitanRegion || "";
      const position = governor.position || "";

      let matchedWinner = null;

      if (isBasic) {
        // 기초단체장: 직책명으로 매칭 (예: "종로구청장" → wiwName="종로구")
        const positionBase = position.replace(/청장$/, "").replace(/시장$/, "").replace(/군수$/, "");

        matchedWinner = winners.find((w: any) => {
          const wiwName = w.wiwName || "";
          const sggName = w.sggName || "";

          return wiwName.includes(positionBase) || sggName.includes(positionBase) || positionBase.includes(wiwName);
        });
      } else {
        // 광역단체장: 시도명으로 매칭
        matchedWinner = winners.find((w: any) => {
          const sdName = w.sdName || "";
          return sdName.includes(region.replace(/특별시|광역시|특별자치시|특별자치도|도$/g, ""));
        });
      }

      if (matchedWinner) {
        const winnerName = matchedWinner.name || "";
        // 이름에서 "(대행)" 제거 후 전임자 정보 추가
        const cleanName = governor.name.replace(/\s*\(대행\)/, "").trim();
        const formattedName = `${winnerName} → ${cleanName}(대행)`;

        return {
          ...governor,
          name: formattedName,
          previousGovernor: winnerName, // 별도 필드로도 저장
        };
      } else {
        return governor;
      }
    });

    return updatedGovernors;
  } catch (error: any) {
    console.error("❌ 대행자-당선인 매칭 실패:", error.message);
    console.error(error.stack);
    return governors; // 실패 시 원본 반환
  }
}

// 광역단체장 데이터 스크래핑
async function scrapeMetropolitanGovernors() {
  let browser;
  try {
    console.log("🔄 광역단체장 스크래핑 시작...");

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // User-Agent 설정 (실제 브라우저처럼 보이게)
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    await page.goto("https://ko.wikipedia.org/wiki/광역지방자치단체장", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    const data = await page.evaluate(() => {
      const results: any[] = [];
      const debugInfo: any[] = [];
      // wikitable 클래스만 선택
      const tables = document.querySelectorAll("table.wikitable");

      tables.forEach((table, tableIdx) => {
        const rows = table.querySelectorAll("tr");
        let tableCount = 0;

        rows.forEach((row, idx) => {
          // 첫 번째 행은 헤더이므로 스킵
          if (idx === 0) return;

          const cells = row.querySelectorAll("td");

          // 셀이 4개 미만이면 스킵
          if (cells.length < 4) return;

          // HTML 구조: 광역단체장 | 정당색 | 정당명 | 이름 | 비고
          const positionRaw = cells[0]?.textContent?.trim() || "";
          const party = cells[2]?.textContent?.trim() || "무소속";
          const name = cells[3]?.textContent?.trim() || "";
          const notes = cells[4]?.textContent?.trim() || "";

          // 광역 지역명 추출 (필터링용) - 직책명만 제거하고 지역명은 유지
          const metropolitanRegion = positionRaw
            .replace(/(시)장$/, "$1") // "시장" → "시"
            .replace(/(도)지사$/, "$1"); // "도지사" → "도"

          // 유효한 데이터인지 확인
          const isValid =
            metropolitanRegion &&
            name &&
            (metropolitanRegion.includes("특별시") ||
              metropolitanRegion.includes("광역시") ||
              metropolitanRegion.includes("특별자치") ||
              metropolitanRegion.endsWith("도"));

          if (isValid) {
            tableCount++;
            results.push({
              metropolitanRegion: metropolitanRegion, // 필터링용
              position: positionRaw, // 직책명 (예: "서울특별시장")
              name: name,
              party: party,
              inaugurationDate: "2022-07-01", // 기본값
              status: notes.includes("권한대행") || notes.includes("직무대행") ? "권한대행" : "재임",
              notes: notes,
            });
          } else {
            // 유효하지 않은 데이터 디버깅
            if (positionRaw && name) {
              debugInfo.push({
                tableIdx,
                rowIdx: idx,
                positionRaw,
                name,
                metropolitanRegion,
                reason: "유효성 검증 실패",
              });
            }
          }
        });

        debugInfo.push({
          tableIdx,
          totalRows: rows.length,
          validCount: tableCount,
        });
      });

      return { results, debugInfo };
    });

    await browser.close();
    browser = null;

    const results = data.results;

    // 데이터 검증
    console.log(`📊 광역단체장 ${results.length}개 수집 완료`);
    if (results.length !== 17) {
      console.warn(`⚠️ 광역단체장 개수 불일치: ${results.length}개 (예상: 17개)`);
    }

    return { success: true, data: results };
  } catch (error: any) {
    console.error("❌ 광역단체장 스크래핑 실패:", error.message);
    return { success: false, data: [], error: error.message };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// 기초단체장 데이터 스크래핑
async function scrapeBasicGovernors() {
  let browser;
  try {
    console.log("🔄 기초단체장 스크래핑 시작...");

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // User-Agent 설정
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    await page.goto("https://ko.wikipedia.org/wiki/기초지방자치단체장", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    const data = await page.evaluate(() => {
      const results: any[] = [];
      const debugInfo: any[] = [];
      // wikitable 클래스만 선택
      const tables = document.querySelectorAll("table.wikitable");

      // 위키백과 기초단체장 페이지의 테이블 순서 (고정)
      // 주의: 세종특별자치시는 기초단체가 없어서 테이블이 없음 (건너뜀)
      const metroOrder = [
        "서울특별시", // 테이블 0
        "부산광역시", // 테이블 1
        "대구광역시", // 테이블 2
        "인천광역시", // 테이블 3
        "광주광역시", // 테이블 4
        "대전광역시", // 테이블 5
        "울산광역시", // 테이블 6
        "경기도", // 테이블 7 (세종 건너뜀)
        "강원특별자치도", // 테이블 8
        "충청북도", // 테이블 9
        "충청남도", // 테이블 10
        "전북특별자치도", // 테이블 11
        "전라남도", // 테이블 12
        "경상북도", // 테이블 13
        "경상남도", // 테이블 14
      ];

      tables.forEach((table, tableIdx) => {
        const rows = table.querySelectorAll("tr");

        // 테이블 인덱스로 광역 할당 (단순하고 확실함)
        let currentMetro = metroOrder[tableIdx] || "미분류";
        debugInfo.push({ tableIdx, metro: currentMetro });

        let rowCount = 0;

        rows.forEach((row, idx) => {
          const cells = row.querySelectorAll("td");
          const thCells = row.querySelectorAll("th");

          // 헤더 행인 경우
          if (thCells.length > 0) {
            return;
          }

          // 광역단체 구분 행인 경우 (colspan이 크거나 셀이 적음) - 보조 체크
          if (cells.length <= 2) {
            const text = cells[0]?.textContent?.trim() || "";
            if (text.includes("특별시") || text.includes("광역시") || text.includes("도") || text.includes("특별자치")) {
              currentMetro = text;
              console.log(`행에서 광역 구분 발견: ${currentMetro}`);
            }
            return;
          }

          // 데이터 행인 경우 (셀이 4개 이상)
          if (cells.length >= 4) {
            // HTML 구조: 기초단체장 | 정당색 | 정당명 | 이름 | 비고
            const positionRaw = cells[0]?.textContent?.trim() || "";
            const party = cells[2]?.textContent?.trim() || "무소속";
            const name = cells[3]?.textContent?.trim() || "";
            const notes = cells[4]?.textContent?.trim() || "";

            // 유효한 데이터인지 확인
            const isValid =
              positionRaw && name && (positionRaw.includes("시장") || positionRaw.includes("군수") || positionRaw.includes("구청장") || currentMetro);

            if (isValid) {
              rowCount++;
              results.push({
                metropolitanRegion: currentMetro || "미분류",
                position: positionRaw, // 직책명 (예: "종로구청장", "수원시장")
                name: name,
                party: party,
                inaugurationDate: "2022-07-01",
                status: notes.includes("권한대행") || notes.includes("직무대행") ? "권한대행" : "재임",
                notes: notes,
              });
            }
          }
        });

        debugInfo.push({ tableIdx, dataCount: rowCount, metro: currentMetro });
      });

      return { results, debugInfo };
    });

    const results = data.results;

    await browser.close();
    browser = null;

    // 데이터 검증
    console.log(`📊 기초단체장 ${results.length}개 수집 완료`);
    if (results.length < 200) {
      console.warn(`⚠️ 기초단체장 개수가 적음: ${results.length}개 (예상: 226개)`);
    }

    return { success: true, data: results };
  } catch (error: any) {
    console.error("❌ 기초단체장 스크래핑 실패:", error.message);
    return { success: false, data: [], error: error.message };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// MongoDB에 광역단체장 데이터 저장
async function saveMetropolitanGovernors(data: any[]) {
  try {
    await metropolitanGovernorsCollection.updateOne(
      { _id: "current" },
      {
        $set: {
          governors: data,
          lastUpdated: new Date(),
          scrapedCount: data.length,
          lastScrapedUrl: "https://ko.wikipedia.org/wiki/%EA%B4%91%EC%97%AD%EC%A7%80%EB%B0%A9%EC%9E%90%EC%B9%98%EB%8B%A8%EC%B2%B4%EC%9E%A5",
        },
      },
      { upsert: true }
    );
    console.log(`✅ 광역단체장 ${data.length}개 MongoDB 저장 완료`);
    return true;
  } catch (error) {
    console.error("❌ 광역단체장 MongoDB 저장 실패:", error);
    return false;
  }
}

// MongoDB에 기초단체장 데이터 저장
async function saveBasicGovernors(data: any[]) {
  try {
    await basicGovernorsCollection.updateOne(
      { _id: "current" },
      {
        $set: {
          governors: data,
          lastUpdated: new Date(),
          scrapedCount: data.length,
          lastScrapedUrl: "https://ko.wikipedia.org/wiki/%EA%B8%B0%EC%B4%88%EC%A7%80%EB%B0%A9%EC%9E%90%EC%B9%98%EB%8B%A8%EC%B2%B4%EC%9E%A5",
        },
      },
      { upsert: true }
    );
    console.log(`✅ 기초단체장 ${data.length}개 MongoDB 저장 완료`);
    return true;
  } catch (error) {
    console.error("❌ 기초단체장 MongoDB 저장 실패:", error);
    return false;
  }
}

// (삭제됨) 이제 17개 모두 자동 스크래핑으로 수집하므로 수동 fallback 불필요

// 단체장 데이터 스크래핑 + 저장 통합 함수
async function fetchAndCacheGovernors() {
  try {
    console.log("⏰ 단체장 데이터 갱신 시작...");

    // 광역단체장 스크래핑
    const metroResult = await scrapeMetropolitanGovernors();
    if (metroResult.success && metroResult.data.length > 0) {
      // 대행자와 전임 당선인 매칭
      const matchedMetroData = await matchActingGovernorsWithWinners(metroResult.data, false);
      await saveMetropolitanGovernors(matchedMetroData);
      if (metroResult.data.length < 17) {
        console.log(`⚠️ 광역단체장 ${metroResult.data.length}개만 스크래핑됨 (예상: 17개)`);
      }
    } else {
      console.log("⚠️ 광역단체장 스크래핑 실패");
    }

    // 기초단체장 스크래핑
    const basicResult = await scrapeBasicGovernors();
    if (basicResult.success && basicResult.data.length > 0) {
      // 대행자와 전임 당선인 매칭
      const matchedBasicData = await matchActingGovernorsWithWinners(basicResult.data, true);
      await saveBasicGovernors(matchedBasicData);
    }

    console.log("✅ 단체장 데이터 갱신 완료");
    return true;
  } catch (error) {
    console.error("❌ 단체장 데이터 갱신 실패:", error);
    return false;
  }
}

// ========== 공약 관련 함수 ==========

// 역대 단체장 검색 (MongoDB에서 해당 지역 단체장 찾아서 검색)
async function findPreviousGovernors(region: string, isBasic: boolean = false) {
  try {
    // 1. MongoDB에서 해당 지역의 현재 단체장 찾기
    const normalizedRegion = normalizeRegionName(region);

    const collection = isBasic ? basicGovernorsCollection : metropolitanGovernorsCollection;
    const cachedData = await collection.findOne({ _id: "current" });

    if (!cachedData || !cachedData.governors) {
      return [];
    }

    // 해당 지역의 단체장 찾기
    const currentGovernor = cachedData.governors.find((g: any) => {
      if (isBasic) {
        return g.metropolitanRegion === normalizedRegion || g.metropolitanRegion?.includes(normalizedRegion);
      } else {
        return g.metropolitanRegion === normalizedRegion || g.position?.includes(normalizedRegion);
      }
    });

    if (!currentGovernor) {
      return [];
    }

    // 2. 해당 지역의 모든 후보자 검색 (모든 단체장 이름으로 시도)
    const apiKey = process.env.VITE_DATAGO_API_KEY;
    const sgTypecode = isBasic ? "4" : "3";
    let allCandidates: any[] = [];

    for (const governor of cachedData.governors) {
      // 이름에서 특수문자 제거
      let cleanName = (governor.name || "")
        .replace(/\s*\(.*?\)/g, "") // 모든 괄호 제거
        .trim();

      if (!cleanName) continue;

      try {
        const url = `https://apis.data.go.kr/9760000/CndaSrchService/getCndaSrchInqire?serviceKey=${encodeURIComponent(apiKey)}&name=${encodeURIComponent(
          cleanName
        )}&numOfRows=50&resultType=json`;

        const response = await fetch(url);
        if (!response.ok) continue;

        const text = await response.text();
        const data = JSON.parse(text);

        let items = [];
        if (data.response?.body?.items?.item) {
          items = Array.isArray(data.response.body.items.item) ? data.response.body.items.item : [data.response.body.items.item];
        }

        // 해당 지역 + 선거종류 + 당선자 필터링
        const filtered = items.filter((item: any) => {
          const matchesRegion =
            item.sidoName === normalizedRegion || item.sidoName?.includes(normalizedRegion.replace(/특별시|광역시|특별자치시|특별자치도/g, ""));
          const matchesType = item.sgTypecode === sgTypecode;
          const isWinner = item.elcoYn === "Y";

          return matchesRegion && matchesType && isWinner;
        });

        allCandidates.push(...filtered);
      } catch (err) {
        // 개별 검색 실패는 무시하고 계속
        continue;
      }
    }

    // 3. 중복 제거 (huboid 기준)
    const uniqueCandidates = Array.from(new Map(allCandidates.map((item) => [item.huboid, item])).values());

    // 4. 지방선거 당선자만 필터링
    const localElectionWinners = uniqueCandidates;

    if (localElectionWinners.length === 0) {
      return [];
    }

    // 5. 선거ID 기준 내림차순 정렬 (최신순)
    const sortedWinners = localElectionWinners.sort((a: any, b: any) => {
      return parseInt(b.sgId || "0") - parseInt(a.sgId || "0");
    });

    return sortedWinners.map((item: any) => ({
      name: item.name || "",
      jdName: item.jdName || "",
      sgId: item.sgId || "",
      sgName: item.sgName || "",
      huboid: item.huboid || "",
      sgTypecode: item.sgTypecode || "",
    }));
  } catch (error: any) {
    console.error("❌ 역대 단체장 검색 실패:", error.message);
    return [];
  }
}

// 후보자 통합검색 API 호출
async function searchCandidate(name: string) {
  try {
    const apiKey = process.env.VITE_DATAGO_API_KEY;
    const url = `https://apis.data.go.kr/9760000/CndaSrchService/getCndaSrchInqire?serviceKey=${encodeURIComponent(apiKey)}&name=${encodeURIComponent(
      name
    )}&numOfRows=50&resultType=json`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API 호출 실패: ${response.status}`);
    }

    const text = await response.text();

    // JSON 파싱 시도
    try {
      const data = JSON.parse(text);

      // 응답 구조 확인 및 파싱
      let items = [];
      if (data.response?.body?.items?.item) {
        items = Array.isArray(data.response.body.items.item) ? data.response.body.items.item : [data.response.body.items.item];
      }

      if (items.length === 0) {
        return null;
      }

      // 지방선거 당선자 필터링
      const localElectionWinners = items.filter((item: any) => {
        const sgTypecode = item.sgTypecode || "";
        const elcoYn = item.elcoYn || "";

        // sgTypecode 3: 광역단체장 (시/도지사)
        // sgTypecode 4: 기초단체장 (시장, 군수, 구청장)
        // elcoYn "Y": 당선자
        return (sgTypecode === "3" || sgTypecode === "4") && elcoYn === "Y";
      });

      if (localElectionWinners.length === 0) {
        return null;
      }

      // 가장 최근 선거 찾기 (sgId가 가장 큰 것)
      const latestCandidate = localElectionWinners.reduce((latest: any, current: any) => {
        const latestSgId = parseInt(latest.sgId || "0");
        const currentSgId = parseInt(current.sgId || "0");
        return currentSgId > latestSgId ? current : latest;
      });

      return {
        huboid: latestCandidate.huboid,
        sgId: latestCandidate.sgId,
        sgTypecode: latestCandidate.sgTypecode,
        name: latestCandidate.name,
        jdName: latestCandidate.jdName,
        elcoYn: latestCandidate.elcoYn,
        sidoName: latestCandidate.sidoName || "",
        sggName: latestCandidate.sggName || "",
      };
    } catch (jsonError) {
      console.error("❌ JSON 파싱 실패:", text.substring(0, 200));
      throw new Error("API 응답 파싱 실패");
    }
  } catch (error: any) {
    console.error("❌ 후보자 검색 실패:", error.message);
    throw error;
  }
}

// 공약 조회 API 호출
async function fetchPledges(huboid: string, sgId: string, sgTypecode: string) {
  try {
    const apiKey = process.env.VITE_DATAGO_API_KEY;
    const url = `http://apis.data.go.kr/9760000/ElecPrmsInfoInqireService/getCnddtElecPrmsInfoInqire?serviceKey=${encodeURIComponent(
      apiKey
    )}&sgId=${sgId}&sgTypecode=${sgTypecode}&cnddtId=${huboid}&numOfRows=100&resultType=json`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`공약 API 호출 실패: ${response.status}`);
    }

    const text = await response.text();

    try {
      const data = JSON.parse(text);

      // 응답 구조 확인
      let item = null;
      if (data.response?.body?.items?.item) {
        item = Array.isArray(data.response.body.items.item) ? data.response.body.items.item[0] : data.response.body.items.item;
      }

      if (!item) {
        return null;
      }

      return item;
    } catch (jsonError) {
      console.error("❌ 공약 JSON 파싱 실패:", text.substring(0, 200));
      throw new Error("공약 API 응답 파싱 실패");
    }
  } catch (error: any) {
    console.error("❌ 공약 조회 실패:", error.message);
    throw error;
  }
}

// 공약 데이터 파싱 (공약1~10을 배열로 변환)
function parsePledges(apiResponse: any) {
  const pledges: any[] = [];

  // prmsOrd1~10, prmsRealmName1~10, prmsTitle1~10, prmmCont1~10을 배열로 변환
  for (let i = 1; i <= 10; i++) {
    const ord = apiResponse[`prmsOrd${i}`];
    if (ord) {
      pledges.push({
        prmsOrd: parseInt(ord),
        prmsRealmName: apiResponse[`prmsRealmName${i}`] || "",
        prmsTitle: apiResponse[`prmsTitle${i}`] || "",
        prmsCont: apiResponse[`prmmCont${i}`] || "", // prmmCont (m 두 개!)
      });
    }
  }

  return {
    resultCode: "00",
    resultMsg: "정상 처리되었습니다",
    krName: apiResponse.krName || "",
    partyName: apiResponse.partyName || "",
    sidoName: apiResponse.sidoName || "",
    sggName: apiResponse.sggName || "",
    prmsCnt: parseInt(apiResponse.prmsCnt || "0"),
    pledges,
  };
}

// 국회의원 정보 조회 API
app.get("/api/assembly/members", async (req, res) => {
  try {
    // Get optional region parameter
    const regionFilter = req.query.region as string | undefined;

    // Fetch cached data from MongoDB
    const cachedData = await assemblyMembersCollection.findOne({ _id: "current" });

    if (!cachedData || !Array.isArray(cachedData.members)) {
      return res.status(503).json({ error: "데이터가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요." });
    }

    let filteredRows = cachedData.members;

    // Apply region filter if provided
    if (regionFilter) {
      // Remove "도" suffix for matching (경기도 → 경기, 강원도 → 강원)
      const normalizedFilter = regionFilter.replace(/도$/, "");

      filteredRows = filteredRows.filter((row) => {
        const district = row.ORIG_NM || "";
        // Match by prefix - e.g., "서울" matches "서울 강남구갑", "경기" matches "경기 안양시만안구"
        return district.startsWith(normalizedFilter);
      });
    }

    res.json(filteredRows);
  } catch (err) {
    console.error("데이터 조회 실패:", err);
    res.status(500).json({ error: "데이터 조회 실패" });
  }
});

// ========== 단체장 API ==========

// 광역단체장 정보 조회 API
// 지역명 매핑 함수 (프론트 → 백엔드)
function normalizeRegionName(regionName: string): string {
  const regionMap: Record<string, string> = {
    서울: "서울특별시",
    부산: "부산광역시",
    대구: "대구광역시",
    인천: "인천광역시",
    광주: "광주광역시",
    대전: "대전광역시",
    울산: "울산광역시",
    세종: "세종특별자치시",
    경기도: "경기도",
    강원도: "강원특별자치도",
    충북: "충청북도",
    충남: "충청남도",
    전북: "전북특별자치도",
    전남: "전라남도",
    경북: "경상북도",
    경남: "경상남도",
    제주: "제주특별자치도",
  };

  return regionMap[regionName] || regionName;
}

app.get("/api/governors/metropolitan", async (req, res) => {
  try {
    const regionFilter = req.query.region as string | undefined;
    const cachedData = await metropolitanGovernorsCollection.findOne({ _id: "current" });

    if (!cachedData || !Array.isArray(cachedData.governors)) {
      return res.status(503).json({
        error: "데이터가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.",
      });
    }

    let governors = cachedData.governors;

    // 지역 필터링
    if (regionFilter) {
      const normalizedRegion = normalizeRegionName(regionFilter);
      governors = governors.filter((g: any) => g.metropolitanRegion && g.metropolitanRegion.includes(normalizedRegion));
    }

    res.json({
      governors: governors,
      lastUpdated: cachedData.lastUpdated,
      count: governors.length,
    });
  } catch (err) {
    console.error("광역단체장 데이터 조회 실패:", err);
    res.status(500).json({ error: "데이터 조회 실패" });
  }
});

// 기초단체장 정보 조회 API
app.get("/api/governors/basic", async (req, res) => {
  try {
    const metroFilter = req.query.metro as string | undefined;

    const cachedData = await basicGovernorsCollection.findOne({ _id: "current" });

    if (!cachedData || !Array.isArray(cachedData.governors)) {
      return res.status(503).json({
        error: "데이터가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.",
      });
    }

    let governors = cachedData.governors;

    // 광역 필터링 (정확한 매칭)
    if (metroFilter) {
      const normalizedRegion = normalizeRegionName(metroFilter);
      governors = governors.filter((g: any) => {
        if (!g.metropolitanRegion) return false;

        const metroRegion = g.metropolitanRegion.trim();

        // 정확한 매칭 또는 포함 관계
        return (
          metroRegion === normalizedRegion || // 정확히 일치
          metroRegion === metroFilter || // 원본과 일치
          metroRegion.startsWith(normalizedRegion) || // 정규화된 이름으로 시작
          metroRegion.startsWith(metroFilter) // 원본 이름으로 시작
        );
      });
    }

    res.json({
      governors: governors,
      lastUpdated: cachedData.lastUpdated,
      count: governors.length,
    });
  } catch (err) {
    console.error("기초단체장 데이터 조회 실패:", err);
    res.status(500).json({ error: "데이터 조회 실패" });
  }
});

// 단체장 데이터 수동 갱신 API
app.post("/api/governors/refresh", async (req, res) => {
  try {
    console.log("🔄 수동 갱신 트리거됨");
    const success = await fetchAndCacheGovernors();

    if (success) {
      res.json({ success: true, message: "단체장 데이터 갱신 완료" });
    } else {
      res.status(500).json({ success: false, message: "일부 데이터 갱신 실패" });
    }
  } catch (err) {
    console.error("단체장 데이터 갱신 실패:", err);
    res.status(500).json({ success: false, error: "데이터 갱신 실패" });
  }
});

// 역대 단체장 조회 API (pledges보다 먼저 정의해야 함)
app.get("/api/governors/previous/:region", async (req, res) => {
  try {
    const region = req.params.region; // Express가 이미 디코딩함
    const isBasic = req.query.isBasic === "true";

    const previousGovernors = await findPreviousGovernors(region, isBasic);

    if (previousGovernors.length === 0) {
      return res.status(404).json({
        error: "역대 단체장을 찾을 수 없습니다",
        region,
      });
    }

    res.json({
      region,
      isBasic,
      governors: previousGovernors,
      count: previousGovernors.length,
    });
  } catch (err: any) {
    console.error("❌ 역대 단체장 조회 실패:", err);
    res.status(500).json({ error: "역대 단체장 조회 실패", details: err.message });
  }
});

// 단체장 공약 조회 API
app.get("/api/governors/pledges/:name", async (req, res) => {
  try {
    const governorName = decodeURIComponent(req.params.name);

    // 1. MongoDB 캐시 확인
    const cached = await pledgesCollection.findOne({
      governorName,
      expiresAt: { $gt: new Date() },
    });

    if (cached) {
      return res.json(cached.pledges);
    }

    // 2. 후보자 검색
    const candidate = await searchCandidate(governorName);
    if (!candidate || !candidate.huboid) {
      return res.status(404).json({
        error: "후보자를 찾을 수 없습니다",
        suggestion: "이름을 정확히 입력했는지 확인해주세요",
      });
    }

    // 3. 공약 조회
    const pledgeData = await fetchPledges(candidate.huboid, candidate.sgId, candidate.sgTypecode);

    if (!pledgeData) {
      return res.status(404).json({
        error: "공약 데이터를 찾을 수 없습니다",
      });
    }

    // 4. 공약 데이터 파싱
    const parsedPledges = parsePledges(pledgeData);

    // 5. MongoDB에 캐싱 (7일간)
    await pledgesCollection.updateOne(
      { governorName },
      {
        $set: {
          governorName,
          pledges: parsedPledges,
          candidateInfo: candidate,
          cachedAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
      { upsert: true }
    );

    res.json(parsedPledges);
  } catch (err: any) {
    console.error("❌ 공약 조회 실패:", err);
    res.status(500).json({ error: "공약 조회 실패", details: err.message });
  }
});

// 디버그: 공약 캐시 데이터 조회
app.get("/api/governors/pledges-debug/:name", async (req, res) => {
  try {
    const governorName = decodeURIComponent(req.params.name);
    const cached = await pledgesCollection.findOne({ governorName });

    if (!cached) {
      return res.status(404).json({ error: "캐시된 데이터 없음" });
    }

    res.json(cached);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 디버그: 공약 캐시 삭제
app.delete("/api/governors/pledges-debug/:name", async (req, res) => {
  try {
    const governorName = decodeURIComponent(req.params.name);
    const result = await pledgesCollection.deleteOne({ governorName });
    res.json({ deleted: result.deletedCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 게시판 API ==========

// 게시글 목록 조회 (페이지네이션)
app.get("/api/board/posts", async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 15, 50);
    const skip = (page - 1) * limit;

    // 게시글 목록 조회 (삭제되지 않은 글만)
    const posts = await postsCollection
      .find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .project({ password: 0 }) // 비밀번호 필드 제외
      .toArray();

    // 각 게시글의 댓글 개수 계산
    const postsWithCommentCount = await Promise.all(
      posts.map(async (post) => {
        const commentCount = await commentsCollection.countDocuments({
          postId: post._id,
          isDeleted: false,
        });
        return {
          ...post,
          commentCount,
        };
      })
    );

    // 전체 게시글 개수
    const totalPosts = await postsCollection.countDocuments({ isDeleted: false });
    const totalPages = Math.ceil(totalPosts / limit);

    res.json({
      posts: postsWithCommentCount,
      pagination: {
        currentPage: page,
        totalPages,
        totalPosts,
        limit,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    console.error("게시글 목록 조회 실패:", err);
    res.status(500).json({ error: "게시글 목록 조회 실패" });
  }
});

// 게시글 상세 조회 (조회수 증가)
app.get("/api/board/posts/:id", async (req, res) => {
  try {
    const postId = new ObjectId(req.params.id as string);

    // 게시글 조회 및 조회수 증가
    const post = await postsCollection.findOneAndUpdate(
      { _id: postId, isDeleted: false },
      { $inc: { viewCount: 1 } },
      { returnDocument: "after", projection: { password: 0 } }
    );

    if (!post) {
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다" });
    }

    res.json({ post });
  } catch (err) {
    console.error("게시글 조회 실패:", err);
    res.status(500).json({ error: "게시글 조회 실패" });
  }
});

// 게시글 작성
app.post("/api/board/posts", postLimiter, async (req, res) => {
  try {
    const { title, content, nickname, password } = req.body;

    // 유효성 검증
    if (!title || title.length < 1 || title.length > 100) {
      return res.status(400).json({ error: "제목은 1~100자여야 합니다" });
    }
    if (!content || content.length < 1 || content.length > 5000) {
      return res.status(400).json({ error: "내용은 1~5000자여야 합니다" });
    }
    if (!nickname || nickname.length < 1 || nickname.length > 20) {
      return res.status(400).json({ error: "닉네임은 1~20자여야 합니다" });
    }
    if (!password || password.length < 4 || password.length > 20) {
      return res.status(400).json({ error: "비밀번호는 4~20자여야 합니다" });
    }

    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(password, 10);

    // 게시글 저장
    const result = await postsCollection.insertOne({
      title,
      content,
      nickname,
      password: hashedPassword,
      viewCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      isDeleted: false,
    });

    res.status(201).json({
      success: true,
      postId: result.insertedId.toString(),
      message: "게시글이 작성되었습니다",
    });
  } catch (err) {
    console.error("게시글 작성 실패:", err);
    res.status(500).json({ error: "게시글 작성 실패" });
  }
});

// 게시글 수정
app.patch("/api/board/posts/:id", async (req, res) => {
  try {
    const postId = new ObjectId(req.params.id as string);
    const { title, content, password, adminPassword } = req.body;

    // 유효성 검증
    if (!title || title.length < 1 || title.length > 100) {
      return res.status(400).json({ error: "제목은 1~100자여야 합니다" });
    }
    if (!content || content.length < 1 || content.length > 5000) {
      return res.status(400).json({ error: "내용은 1~5000자여야 합니다" });
    }

    // 게시글 조회
    const post = await postsCollection.findOne({ _id: postId, isDeleted: false });
    if (!post) {
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다" });
    }

    // 관리자 비밀번호 확인
    if (adminPassword && adminPassword === process.env.ADMIN_PASSWORD) {
      // 관리자 권한으로 즉시 수정
      await postsCollection.updateOne(
        { _id: postId },
        {
          $set: {
            title,
            content,
            updatedAt: new Date(),
          },
        }
      );
      return res.json({ success: true, message: "게시글이 수정되었습니다" });
    }

    // 일반 사용자 비밀번호 검증
    if (!password) {
      return res.status(400).json({ error: "비밀번호를 입력해주세요" });
    }

    const isMatch = await bcrypt.compare(password, post.password);
    if (!isMatch) {
      return res.status(401).json({ error: "비밀번호가 일치하지 않습니다" });
    }

    // 게시글 수정
    await postsCollection.updateOne(
      { _id: postId },
      {
        $set: {
          title,
          content,
          updatedAt: new Date(),
        },
      }
    );

    res.json({ success: true, message: "게시글이 수정되었습니다" });
  } catch (err) {
    console.error("게시글 수정 실패:", err);
    res.status(500).json({ error: "게시글 수정 실패" });
  }
});

// 게시글 삭제
app.delete("/api/board/posts/:id", async (req, res) => {
  try {
    const postId = new ObjectId(req.params.id as string);
    const { password, adminPassword } = req.body;

    // 게시글 조회
    const post = await postsCollection.findOne({ _id: postId, isDeleted: false });
    if (!post) {
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다" });
    }

    // 관리자 비밀번호 확인
    if (adminPassword && adminPassword === process.env.ADMIN_PASSWORD) {
      // 관리자 권한으로 즉시 삭제
      await postsCollection.updateOne({ _id: postId }, { $set: { isDeleted: true, updatedAt: new Date() } });
      return res.json({ success: true, message: "게시글이 삭제되었습니다" });
    }

    // 일반 사용자 비밀번호 검증
    if (!password) {
      return res.status(400).json({ error: "비밀번호를 입력해주세요" });
    }

    const isMatch = await bcrypt.compare(password, post.password);
    if (!isMatch) {
      return res.status(401).json({ error: "비밀번호가 일치하지 않습니다" });
    }

    // 소프트 삭제
    await postsCollection.updateOne({ _id: postId }, { $set: { isDeleted: true, updatedAt: new Date() } });

    res.json({ success: true, message: "게시글이 삭제되었습니다" });
  } catch (err) {
    console.error("게시글 삭제 실패:", err);
    res.status(500).json({ error: "게시글 삭제 실패" });
  }
});

// 게시글 비밀번호 검증 (수정 전 확인용)
app.post("/api/board/posts/:id/verify", async (req, res) => {
  try {
    const postId = new ObjectId(req.params.id as string);
    const { password, adminPassword } = req.body;

    // 게시글 조회
    const post = await postsCollection.findOne({ _id: postId, isDeleted: false });
    if (!post) {
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다" });
    }

    // 관리자 비밀번호 확인
    if (adminPassword && adminPassword === process.env.ADMIN_PASSWORD) {
      return res.json({ success: true, message: "비밀번호가 확인되었습니다" });
    }

    // 일반 사용자 비밀번호 검증
    if (!password) {
      return res.status(400).json({ error: "비밀번호를 입력해주세요" });
    }

    const isMatch = await bcrypt.compare(password, post.password);
    if (!isMatch) {
      return res.status(401).json({ error: "비밀번호가 일치하지 않습니다" });
    }

    res.json({ success: true, message: "비밀번호가 확인되었습니다" });
  } catch (err) {
    console.error("비밀번호 검증 실패:", err);
    res.status(500).json({ error: "비밀번호 검증 실패" });
  }
});

// 댓글 목록 조회
app.get("/api/board/posts/:postId/comments", async (req, res) => {
  try {
    const postId = new ObjectId(req.params.postId as string);

    // 게시글 존재 확인
    const post = await postsCollection.findOne({ _id: postId, isDeleted: false });
    if (!post) {
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다" });
    }

    // 댓글 목록 조회 (삭제되지 않은 댓글만, 오래된 순)
    const comments = await commentsCollection
      .find({ postId: postId, isDeleted: false })
      .sort({ createdAt: 1 })
      .project({ password: 0 }) // 비밀번호 필드 제외
      .toArray();

    res.json({
      comments,
      count: comments.length,
    });
  } catch (err) {
    console.error("댓글 목록 조회 실패:", err);
    res.status(500).json({ error: "댓글 목록 조회 실패" });
  }
});

// 댓글 작성
app.post("/api/board/posts/:postId/comments", postLimiter, async (req, res) => {
  try {
    const postId = new ObjectId(req.params.postId as string);
    const { content, nickname, password } = req.body;

    // 게시글 존재 확인
    const post = await postsCollection.findOne({ _id: postId, isDeleted: false });
    if (!post) {
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다" });
    }

    // 유효성 검증
    if (!content || content.length < 1 || content.length > 500) {
      return res.status(400).json({ error: "댓글은 1~500자여야 합니다" });
    }
    if (!nickname || nickname.length < 1 || nickname.length > 20) {
      return res.status(400).json({ error: "닉네임은 1~20자여야 합니다" });
    }
    if (!password || password.length < 4 || password.length > 20) {
      return res.status(400).json({ error: "비밀번호는 4~20자여야 합니다" });
    }

    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(password, 10);

    // 댓글 저장
    const result = await commentsCollection.insertOne({
      postId: postId,
      content,
      nickname,
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
      isDeleted: false,
    });

    res.status(201).json({
      success: true,
      commentId: result.insertedId.toString(),
      message: "댓글이 작성되었습니다",
    });
  } catch (err) {
    console.error("댓글 작성 실패:", err);
    res.status(500).json({ error: "댓글 작성 실패" });
  }
});

// 댓글 수정
app.patch("/api/board/comments/:id", async (req, res) => {
  try {
    const commentId = new ObjectId(req.params.id as string);
    const { content, password } = req.body;

    // 유효성 검증
    if (!content || content.length < 1 || content.length > 500) {
      return res.status(400).json({ error: "댓글은 1~500자여야 합니다" });
    }
    if (!password) {
      return res.status(400).json({ error: "비밀번호를 입력해주세요" });
    }

    // 댓글 조회
    const comment = await commentsCollection.findOne({ _id: commentId, isDeleted: false });
    if (!comment) {
      return res.status(404).json({ error: "댓글을 찾을 수 없습니다" });
    }

    // 비밀번호 검증
    const isMatch = await bcrypt.compare(password, comment.password);
    if (!isMatch) {
      return res.status(401).json({ error: "비밀번호가 일치하지 않습니다" });
    }

    // 댓글 수정
    await commentsCollection.updateOne(
      { _id: commentId },
      {
        $set: {
          content,
          updatedAt: new Date(),
        },
      }
    );

    res.json({ success: true, message: "댓글이 수정되었습니다" });
  } catch (err) {
    console.error("댓글 수정 실패:", err);
    res.status(500).json({ error: "댓글 수정 실패" });
  }
});

// 댓글 삭제
app.delete("/api/board/comments/:id", async (req, res) => {
  try {
    const commentId = new ObjectId(req.params.id as string);
    const { password, adminPassword } = req.body;

    // 댓글 조회
    const comment = await commentsCollection.findOne({ _id: commentId, isDeleted: false });
    if (!comment) {
      return res.status(404).json({ error: "댓글을 찾을 수 없습니다" });
    }

    // 관리자 비밀번호 확인
    if (adminPassword && adminPassword === process.env.ADMIN_PASSWORD) {
      // 관리자 권한으로 즉시 삭제
      await commentsCollection.updateOne({ _id: commentId }, { $set: { isDeleted: true, updatedAt: new Date() } });
      return res.json({ success: true, message: "댓글이 삭제되었습니다" });
    }

    // 일반 사용자 비밀번호 검증
    if (!password) {
      return res.status(400).json({ error: "비밀번호를 입력해주세요" });
    }

    const isMatch = await bcrypt.compare(password, comment.password);
    if (!isMatch) {
      return res.status(401).json({ error: "비밀번호가 일치하지 않습니다" });
    }

    // 소프트 삭제
    await commentsCollection.updateOne({ _id: commentId }, { $set: { isDeleted: true, updatedAt: new Date() } });

    res.json({ success: true, message: "댓글이 삭제되었습니다" });
  } catch (err) {
    console.error("댓글 삭제 실패:", err);
    res.status(500).json({ error: "댓글 삭제 실패" });
  }
});

// 국회의원 상세 정보 조회 (이름으로)
app.get("/api/assembly/member/:name", async (req, res) => {
  try {
    const memberName = decodeURIComponent(req.params.name);

    // MongoDB에서 국회의원 기본 정보 조회
    const cachedData = await assemblyMembersCollection.findOne({ _id: "current" });
    if (!cachedData) {
      return res.status(404).json({ error: "국회의원 데이터가 없습니다" });
    }

    const member = cachedData.members.find((m: any) => m.HG_NM === memberName);
    if (!member) {
      return res.status(404).json({ error: "해당 국회의원을 찾을 수 없습니다" });
    }

    // 캐시된 발의법률안 데이터 가져오기
    const billsDoc = await billsCollection.findOne({ _id: "current" });

    if (!billsDoc || !billsDoc.bills) {
      return res.status(500).json({ error: "발의법률안 데이터가 캐시되지 않았습니다" });
    }

    const allBills = billsDoc.bills;

    // 대표발의안 필터링 (RST_PROPOSER 사용)
    const representativeBills = allBills.filter((bill) => {
      const rstProposer = bill.RST_PROPOSER || "";
      // RST_PROPOSER와 정확히 일치하는지 확인
      return rstProposer === memberName;
    });

    // 공동발의안 필터링 (PUBL_PROPOSER 사용)
    const jointBills = allBills.filter((bill) => {
      const publProposer = bill.PUBL_PROPOSER || "";
      // PUBL_PROPOSER는 쉼표로 구분된 목록: "이수진,양부남,전진숙,..."
      const proposers = publProposer.split(",").map((p) => p.trim());
      return proposers.includes(memberName);
    });

    res.json({
      member: {
        name: member.HG_NM,
        party: member.POLY_NM,
        region: member.ORIG_NM,
      },
      representativeBills: representativeBills,
      jointBills: jointBills,
      statistics: {
        representativeCount: representativeBills.length,
        jointCount: jointBills.length,
        totalCount: representativeBills.length + jointBills.length,
      },
      lastUpdated: cachedData.lastUpdated,
    });
  } catch (err) {
    console.error("국회의원 상세 정보 조회 실패:", err);
    res.status(500).json({ error: "국회의원 상세 정보 조회 실패" });
  }
});

// ========== 정치성향 테스트 API ==========

// 문항 조회 (캐싱 적용)
async function getQuestions() {
  const now = Date.now();

  // 캐시가 유효한 경우 바로 반환
  if (cachedQuestions && lastQuestionsCacheTime && now - lastQuestionsCacheTime < QUESTIONS_CACHE_DURATION) {
    return cachedQuestions;
  }

  // 캐시가 없거나 만료된 경우 DB에서 조회
  const questions = await questionsCollection.find({}).sort({ order: 1 }).toArray();

  // 캐시 업데이트
  cachedQuestions = questions;
  lastQuestionsCacheTime = now;

  console.log(`✅ 정치성향 테스트 문항 ${questions.length}개 캐싱됨`);

  return questions;
}

// 정치성향 테스트 문항 전체 조회
app.get("/api/political-test/questions", async (req, res) => {
  try {
    const questions = await getQuestions();

    if (!questions || questions.length === 0) {
      return res.status(503).json({
        error: "문항 데이터가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.",
      });
    }

    // _id 필드 제외하고 반환
    const formattedQuestions = questions.map((q) => ({
      questionId: q.questionId,
      order: q.order,
      category: q.category,
      questionText: q.questionText,
      options: q.options,
    }));

    res.json({
      success: true,
      questions: formattedQuestions,
      count: formattedQuestions.length,
    });
  } catch (err) {
    console.error("문항 조회 실패:", err);
    res.status(500).json({ error: "문항 조회 실패" });
  }
});

async function startServer() {
  try {
    await client.connect();
    console.log("✅ MongoDB 연결 성공");

    const db = client.db("kpolitics");
    assemblyMembersCollection = db.collection("assemblyMembers");
    metropolitanGovernorsCollection = db.collection("metropolitanGovernors");
    basicGovernorsCollection = db.collection("basicGovernors");
    postsCollection = db.collection("posts");
    commentsCollection = db.collection("comments");
    billsCollection = db.collection("bills");
    pledgesCollection = db.collection("governorPledges");
    winnersCollection = db.collection("electionWinners"); // 당선인 정보 캐시
    questionsCollection = db.collection("politicalTestQuestions"); // 정치성향 테스트 문항

    // 게시판 인덱스 생성
    await postsCollection.createIndex({ createdAt: -1 });
    await postsCollection.createIndex({ isDeleted: 1 });
    await commentsCollection.createIndex({ postId: 1, createdAt: 1 });
    await commentsCollection.createIndex({ isDeleted: 1 });
    console.log("✅ 게시판 인덱스 생성 완료");

    // 공약 인덱스 생성
    await pledgesCollection.createIndex({ governorName: 1 });
    await pledgesCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    console.log("✅ 공약 인덱스 생성 완료");

    // 정치성향 테스트 인덱스 생성
    await questionsCollection.createIndex({ questionId: 1 }, { unique: true });
    await questionsCollection.createIndex({ order: 1 });
    console.log("✅ 정치성향 테스트 인덱스 생성 완료");

    // 정치성향 테스트 문항 Seed (서버 시작 시 매번 실행)
    try {
      await seedQuestionsData(questionsCollection);
    } catch (seedError) {
      console.error("❌ 문항 Seed 실패:", seedError);
    }

    // Check if cached data exists
    const cachedData = await assemblyMembersCollection.findOne({ _id: "current" });

    if (!cachedData) {
      console.log("⚠️ No cached data found. Fetching immediately...");
      await fetchAndCacheMembers();
    } else {
      console.log(`✅ Cached data found (Last updated: ${cachedData.lastUpdated})`);
      console.log(`📊 ${cachedData.members?.length || 0} members in cache`);
    }

    // 단체장 데이터 초기 로드
    const metroDoc = await metropolitanGovernorsCollection.findOne({ _id: "current" });
    const basicDoc = await basicGovernorsCollection.findOne({ _id: "current" });

    if (!metroDoc || !basicDoc) {
      console.log("⚠️ 단체장 데이터가 없습니다. 즉시 스크래핑을 시작합니다...");
      await fetchAndCacheGovernors();
    } else {
      console.log(`✅ 단체장 데이터 확인 (광역: ${metroDoc.scrapedCount || 0}개, 기초: ${basicDoc.scrapedCount || 0}개)`);
    }

    // 당선인 정보 초기 캐싱 (최초 1회만)
    const metroWinners = await winnersCollection.findOne({ _id: "2022-metro" });
    const basicWinners = await winnersCollection.findOne({ _id: "2022-basic" });

    if (!metroWinners || !basicWinners) {
      console.log("⚠️ 당선인 정보 캐시가 없습니다. 최초 1회 캐싱을 시작합니다...");

      if (!metroWinners) {
        console.log("📋 광역단체장 당선인 정보 캐싱 중...");
        await fetchWinnerInfo("3"); // 광역단체장
      }

      if (!basicWinners) {
        console.log("📋 기초단체장 당선인 정보 캐싱 중...");
        await fetchWinnerInfo("4"); // 기초단체장
      }

      console.log("✅ 당선인 정보 초기 캐싱 완료");
    } else {
      console.log(`✅ 당선인 정보 캐시 확인 (광역: ${metroWinners.winners?.length || 0}명, 기초: ${basicWinners.winners?.length || 0}명)`);
    }

    // 발의법률안 데이터 초기 로드
    const billsDoc = await billsCollection.findOne({ _id: "current" });

    if (!billsDoc) {
      console.log("⚠️ 발의법률안 데이터가 없습니다. 즉시 캐싱을 시작합니다...");
      await fetchAndCacheBills();
    } else {
      console.log(`✅ 발의법률안 데이터 확인 (${billsDoc.bills?.length || 0}건, 마지막 업데이트: ${billsDoc.lastUpdated})`);
    }

    // Schedule daily data refresh at 3:00 AM KST
    cron.schedule("0 3 * * *", async () => {
      console.log("⏰ Scheduled task: Refreshing assembly members data...");
      await fetchAndCacheMembers();
    });

    console.log("⏰ Cron job scheduled: Daily refresh at 3:00 AM");

    // 단체장 데이터 자동 갱신 (매일 새벽 4시)
    cron.schedule("0 4 * * *", async () => {
      console.log("⏰ [CRON] 단체장 데이터 스크래핑 시작...");
      await fetchAndCacheGovernors();
    });

    console.log("⏰ Cron job scheduled: Governors refresh at 4:00 AM");

    // 발의법률안 데이터 자동 갱신 (매일 새벽 5시)
    cron.schedule("0 5 * * *", async () => {
      console.log("⏰ [CRON] 발의법률안 데이터 캐싱 시작...");
      await fetchAndCacheBills();
    });

    console.log("⏰ Cron job scheduled: Bills refresh at 5:00 AM");

    // 포트 설정 - Render는 자동으로 PORT 환경변수 제공
    const PORT = process.env.PORT || 4001;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 Allowed origins: ${allowedOrigins.join(", ")}`);
    });
  } catch (err) {
    console.error("❌ Server startup failed:", err);
  }
}

startServer();
