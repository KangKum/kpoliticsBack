import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI 환경변수가 설정되지 않았습니다");
}

const client = new MongoClient(uri);

// 문항 순서를 섞는 함수 (Fisher-Yates shuffle)
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function seedQuestions() {
  try {
    await client.connect();
    console.log("✅ MongoDB 연결 성공");

    const db = client.db("kpolitics");
    const collection = db.collection("politicalTestQuestions");

    // 기존 문항 삭제
    await collection.deleteMany({});
    console.log("🗑️ 기존 문항 삭제 완료");

    // 문항 데이터 정의 (testplan.md 기준)
    const questions = [
      // 경제 파트 (Q1-Q6)
      {
        questionId: "Q1",
        category: "economy",
        questionText:
          "세금이 월 3~5만 원 늘지만, 병원비·교육비 부담이 크게 줄어든다면?",
        options: [
          { label: "A", text: "부담이 있어도 이런 변화라면 받아들일 수 있다", score: -2 },
          { label: "B", text: "어느 정도라면 감수할 수 있다", score: -1 },
          { label: "C", text: "세금 부담이 늘어나는 건 불편하다", score: 1 },
          { label: "D", text: "세금이 늘어나는 방식은 받아들이기 어렵다", score: 2 },
        ],
      },
      {
        questionId: "Q2",
        category: "economy",
        questionText:
          "당신이 일하는 회사나 동네 가게에서\n인건비 부담 때문에 가격 인상이나 고용 축소를 고민하고 있다면?",
        options: [
          { label: "A", text: "그래도 최저 생계 보장은 우선이다", score: -2 },
          { label: "B", text: "천천히 조정하면서 올리는 건 필요하다", score: -1 },
          { label: "C", text: "속도를 조절해야 한다", score: 1 },
          { label: "D", text: "이런 부담은 결국 모두에게 손해다", score: 2 },
        ],
      },
      {
        questionId: "Q3",
        category: "economy",
        questionText: "대기업이 시장을 거의 장악해\n소상공인이 계속 문을 닫는 상황을 본다면?",
        options: [
          { label: "A", text: "강한 규제로 균형을 맞춰야 한다", score: -2 },
          { label: "B", text: "일부 규제는 필요하다", score: -1 },
          { label: "C", text: "경쟁은 자연스럽게 정리된다", score: 1 },
          { label: "D", text: "규제보다는 기업 성장이 중요하다", score: 2 },
        ],
      },
      {
        questionId: "Q4",
        category: "economy",
        questionText: "당신이 살고 싶은 지역의 집값이 급등해\n내 집 마련이 점점 어려워진 상황이라면?",
        options: [
          { label: "A", text: "다주택자 규제와 세금을 강화해야 한다", score: -2 },
          { label: "B", text: "규제와 공급을 함께 늘려야 한다", score: -1 },
          { label: "C", text: "신규 주택을 많이 공급하는 게 우선이다", score: 1 },
          { label: "D", text: "시장 흐름에 맡기는 게 낫다", score: 2 },
        ],
      },
      {
        questionId: "Q5",
        category: "economy",
        questionText: "국가에서 모든 성인에게\n조건 없이 일정 금액을 매달 지급하는 제도를 검토한다면?",
        options: [
          { label: "A", text: "사회 안전망으로 꼭 필요하다", score: -2 },
          { label: "B", text: "일부 계층부터 시범적으로 가능", score: -1 },
          { label: "C", text: "실험 정도만 가능", score: 1 },
          { label: "D", text: "현실적이지 않다", score: 2 },
        ],
      },
      {
        questionId: "Q6",
        category: "economy",
        questionText: '주변에서 "열심히 일해도 삶이 나아지지 않는다"는 말을 자주 듣는다면?',
        options: [
          { label: "A", text: "사회 구조를 바꿔야 한다", score: -2 },
          { label: "B", text: "정부의 역할이 더 필요하다", score: -1 },
          { label: "C", text: "개인 노력도 중요하다", score: 1 },
          { label: "D", text: "결과는 결국 개인 선택이다", score: 2 },
        ],
      },

      // 사회 파트 (Q7-Q12)
      {
        questionId: "Q7",
        category: "society",
        questionText: "학교·회사·사회 전반에서\n새로운 가치와 변화가 빠르게 등장할 때 당신의 생각은?",
        options: [
          { label: "A", text: "빠른 변화가 자연스럽다", score: -2 },
          { label: "B", text: "서서히 적응하면 된다", score: -1 },
          { label: "C", text: "변화 속도가 너무 빠르다", score: 1 },
          { label: "D", text: "전통과 안정이 더 중요하다", score: 2 },
        ],
      },
      {
        questionId: "Q8",
        category: "society",
        questionText: "회사나 학교에서 누군가가\n정체성 때문에 차별을 받았다고 호소한다면?",
        options: [
          { label: "A", text: "법과 제도로 적극 보호해야 한다", score: -2 },
          { label: "B", text: "최소한의 보호는 필요하다", score: -1 },
          { label: "C", text: "사회적 합의가 먼저다", score: 1 },
          { label: "D", text: "제도 개입은 신중해야 한다", score: 2 },
        ],
      },
      {
        questionId: "Q9",
        category: "society",
        questionText: "결혼·가족 형태가 점점 다양해지는 사회를 보며?",
        options: [
          { label: "A", text: "다양한 형태가 존중받아야 한다", score: -2 },
          { label: "B", text: "존중하되 강요는 없어야 한다", score: -1 },
          { label: "C", text: "기존 가족 형태가 여전히 중요하다", score: 1 },
          { label: "D", text: "전통적 가족이 사회의 중심이다", score: 2 },
        ],
      },
      {
        questionId: "Q10",
        category: "society",
        questionText: "학교에서 인성·도덕·생활지도 교육을 강화하자는 의견에 대해?",
        options: [
          { label: "A", text: "개인 선택에 맡겨야 한다", score: -2 },
          { label: "B", text: "최소한의 기준은 필요하다", score: -1 },
          { label: "C", text: "학교의 중요한 역할이다", score: 1 },
          { label: "D", text: "매우 강하게 필요하다", score: 2 },
        ],
      },
      {
        questionId: "Q11",
        category: "society",
        questionText: "온라인에서 혐오 표현이나 과격한 발언이 늘어난다면?",
        options: [
          { label: "A", text: "표현의 자유가 더 중요하다", score: -2 },
          { label: "B", text: "최소한의 기준만 필요하다", score: -1 },
          { label: "C", text: "사회 질서를 위해 제한해야 한다", score: 1 },
          { label: "D", text: "강한 규제가 필요하다", score: 2 },
        ],
      },
      {
        questionId: "Q12",
        category: "society",
        questionText: "사회적 갈등이 발생했을 때\n어떤 접근이 더 낫다고 느끼는가?",
        options: [
          { label: "A", text: "소수자의 보호가 우선이다", score: -2 },
          { label: "B", text: "균형을 맞춰야 한다", score: -1 },
          { label: "C", text: "다수의 의견을 존중해야 한다", score: 1 },
          { label: "D", text: "질서 유지가 가장 중요하다", score: 2 },
        ],
      },

      // 정부 역할 파트 (Q13-Q18)
      {
        questionId: "Q13",
        category: "government",
        questionText: "경제가 어려워질 때 정부의 역할은?",
        options: [
          { label: "A", text: "적극적으로 개입해야 한다", score: -2 },
          { label: "B", text: "필요한 만큼 개입해야 한다", score: -1 },
          { label: "C", text: "최소한만 개입해야 한다", score: 1 },
          { label: "D", text: "시장에 맡기는 게 낫다", score: 2 },
        ],
      },
      {
        questionId: "Q14",
        category: "government",
        questionText: "병원·철도·전기 같은\n생활 필수 서비스 운영 방식으로 더 낫다고 느끼는 것은?",
        options: [
          { label: "A", text: "국가가 직접 운영해야 한다", score: -2 },
          { label: "B", text: "공공 중심 + 일부 민간", score: -1 },
          { label: "C", text: "민간 경쟁이 효율적이다", score: 1 },
          { label: "D", text: "민간이 맡는 게 낫다", score: 2 },
        ],
      },
      {
        questionId: "Q15",
        category: "government",
        questionText: "새로운 규제가 도입될 때 당신의 생각은?",
        options: [
          { label: "A", text: "안전과 공익을 위해 필요하다", score: -2 },
          { label: "B", text: "최소한이라면 수용 가능", score: -1 },
          { label: "C", text: "규제는 줄여야 한다", score: 1 },
          { label: "D", text: "규제는 성장의 걸림돌이다", score: 2 },
        ],
      },
      {
        questionId: "Q16",
        category: "government",
        questionText: "국가 예산을 운영할 때 더 중요하다고 느끼는 것은?",
        options: [
          { label: "A", text: "필요한 곳엔 과감히 써야 한다", score: -2 },
          { label: "B", text: "선별적으로 지출해야 한다", score: -1 },
          { label: "C", text: "균형이 중요하다", score: 1 },
          { label: "D", text: "빚을 줄이는 게 우선이다", score: 2 },
        ],
      },
      {
        questionId: "Q17",
        category: "government",
        questionText: "병원비 부담 문제를 해결하는 방식으로 더 가까운 생각은?",
        options: [
          { label: "A", text: "공공의료를 크게 늘려야 한다", score: -2 },
          { label: "B", text: "점진적으로 확대", score: -1 },
          { label: "C", text: "민간 중심 유지", score: 1 },
          { label: "D", text: "민간이 주도해야 한다", score: 2 },
        ],
      },
      {
        questionId: "Q18",
        category: "government",
        questionText: "문제가 생겼을 때 더 크게 느껴지는 위험은?",
        options: [
          { label: "A", text: "시장이 제대로 작동하지 않는 것", score: -2 },
          { label: "B", text: "시장의 한계", score: -1 },
          { label: "C", text: "정부의 비효율", score: 1 },
          { label: "D", text: "정부 개입 실패", score: 2 },
        ],
      },

      // 안보 파트 (Q19-Q24)
      {
        questionId: "Q19",
        category: "security",
        questionText: "군사적 긴장이 높아졌다는 뉴스를 접했을 때 더 안심되는 대응은?",
        options: [
          { label: "A", text: "대화와 협력 시도", score: -2 },
          { label: "B", text: "대화와 대비를 병행", score: -1 },
          { label: "C", text: "강한 억지력 강조", score: 1 },
          { label: "D", text: "강경 대응이 필요하다", score: 2 },
        ],
      },
      {
        questionId: "Q20",
        category: "security",
        questionText: "국방 예산을 늘리자는 논의에 대해?",
        options: [
          { label: "A", text: "다른 분야가 더 중요하다", score: -2 },
          { label: "B", text: "최소한의 증액은 필요", score: -1 },
          { label: "C", text: "어느 정도 증액 필요", score: 1 },
          { label: "D", text: "적극적으로 늘려야 한다", score: 2 },
        ],
      },
      {
        questionId: "Q21",
        category: "security",
        questionText: "법을 집행할 때 더 중요하다고 느끼는 것은?",
        options: [
          { label: "A", text: "인권과 상황 고려", score: -2 },
          { label: "B", text: "균형 잡힌 판단", score: -1 },
          { label: "C", text: "법과 원칙 우선", score: 1 },
          { label: "D", text: "엄격한 집행", score: 2 },
        ],
      },
      {
        questionId: "Q22",
        category: "security",
        questionText: "대규모 집회·시위가 열릴 때 당신의 생각은?",
        options: [
          { label: "A", text: "최대한 보장해야 한다", score: -2 },
          { label: "B", text: "조건부로 허용", score: -1 },
          { label: "C", text: "질서 유지가 우선", score: 1 },
          { label: "D", text: "강한 통제가 필요", score: 2 },
        ],
      },
      {
        questionId: "Q23",
        category: "security",
        questionText: "강력 범죄가 반복될 때 더 효과적이라 느끼는 대응은?",
        options: [
          { label: "A", text: "예방과 재활 중심", score: -2 },
          { label: "B", text: "예방과 처벌 병행", score: -1 },
          { label: "C", text: "처벌 강화", score: 1 },
          { label: "D", text: "강력한 처벌이 필요", score: 2 },
        ],
      },
      {
        questionId: "Q24",
        category: "security",
        questionText: "사회에서 자유와 안전이 충돌할 때 더 중요한 것은?",
        options: [
          { label: "A", text: "자유가 더 중요하다", score: -2 },
          { label: "B", text: "균형이 중요하다", score: -1 },
          { label: "C", text: "안전이 더 중요하다", score: 1 },
          { label: "D", text: "안전이 최우선이다", score: 2 },
        ],
      },
    ];

    // 문항 순서를 섞음 (파트별로 골고루 분산되도록)
    const shuffledQuestions = shuffleArray(questions);

    // 섞인 순서대로 order 필드 추가 (1~24)
    const questionsWithOrder = shuffledQuestions.map((q, index) => ({
      ...q,
      order: index + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    // MongoDB에 삽입
    await collection.insertMany(questionsWithOrder);

    console.log(`✅ ${questionsWithOrder.length}개 문항 삽입 완료`);
    console.log("\n문항 순서 (파트별):");

    // 파트별 순서 출력
    questionsWithOrder
      .sort((a, b) => a.order - b.order)
      .forEach((q) => {
        const categoryName = {
          economy: "경제",
          society: "사회",
          government: "정부",
          security: "안보",
        }[q.category];
        console.log(`  ${q.order}. ${q.questionId} (${categoryName})`);
      });

    // 파트별 분포 확인
    const distribution = {
      economy: 0,
      society: 0,
      government: 0,
      security: 0,
    };
    questionsWithOrder.forEach((q) => {
      distribution[q.category]++;
    });

    console.log("\n파트별 분포:");
    console.log(`  경제: ${distribution.economy}개`);
    console.log(`  사회: ${distribution.society}개`);
    console.log(`  정부: ${distribution.government}개`);
    console.log(`  안보: ${distribution.security}개`);
  } catch (error) {
    console.error("❌ Seed 실패:", error);
    throw error;
  } finally {
    await client.close();
    console.log("\n✅ MongoDB 연결 종료");
  }
}

// 스크립트 실행
seedQuestions().catch((error) => {
  console.error("❌ Seed 스크립트 실행 실패:", error);
  process.exit(1);
});
