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

// 문항 데이터를 DB에 삽입하는 함수 (export용)
export async function seedQuestionsData(collection: any) {
  // 기존 문항 삭제
  await collection.deleteMany({});
  console.log("🗑️ 기존 문항 삭제 완료");

    // 문항 데이터 정의 (testplan.md 기준)
    const questions = [
      // 경제 파트 (Q1-Q6)
      {
        questionId: "Q1",
        category: "economy",
        questionText: "세금이 월 3~5만 원 늘고, 병원비·교육비 부담이 줄어드는 정책이 시행된다면?",
        options: [
          { label: "A", text: "복지 확대를 위해 세금 증가는 수용할 수 있다", score: -2 },
          { label: "B", text: "일정 수준의 증가는 감수할 수 있다", score: -1 },
          { label: "C", text: "세금 증가는 신중해야 한다", score: 1 },
          { label: "D", text: "세금 인상보다는 다른 방법이 낫다", score: 2 },
        ],
      },
      {
        questionId: "Q2",
        category: "economy",
        questionText: "인건비 부담으로 가격 인상이나 고용 조정을 고민하는 상황이라면?",
        options: [
          { label: "A", text: "최저 생계 보장을 우선 고려해야 한다", score: -2 },
          { label: "B", text: "단계적으로 조정하는 방식이 적절하다", score: -1 },
          { label: "C", text: "경제 상황에 맞춰 속도를 조절해야 한다", score: 1 },
          { label: "D", text: "시장 자율에 맡기는 것이 낫다", score: 2 },
        ],
      },
      {
        questionId: "Q3",
        category: "economy",
        questionText: "대기업 중심 구조로 소상공인의 어려움이 커지는 상황을 본다면?",
        options: [
          { label: "A", text: "강한 규제를 통해 균형을 맞춰야 한다", score: -2 },
          { label: "B", text: "일부 조정 장치는 필요하다", score: -1 },
          { label: "C", text: "시장 경쟁 과정으로 볼 수 있다", score: 1 },
          { label: "D", text: "기업 성장이 우선 고려되어야 한다", score: 2 },
        ],
      },
      {
        questionId: "Q4",
        category: "economy",
        questionText: "주택 가격 상승으로 내 집 마련이 어려워지는 상황이라면?",
        options: [
          { label: "A", text: "다주택자 규제와 세금 강화를 고려해야 한다", score: -2 },
          { label: "B", text: "규제와 공급을 병행하는 방식이 필요하다", score: -1 },
          { label: "C", text: "공급 확대가 우선이라고 본다", score: 1 },
          { label: "D", text: "시장 흐름에 맡기는 편이 낫다", score: 2 },
        ],
      },
      {
        questionId: "Q5",
        category: "economy",
        questionText: "모든 성인에게 일정 금액을 정기적으로 지급하는 제도를 검토한다면?",
        options: [
          { label: "A", text: "사회 안전망으로 긍정적으로 본다", score: -2 },
          { label: "B", text: "제한적인 범위에서 검토할 수 있다", score: -1 },
          { label: "C", text: "실험적 도입 정도는 가능하다", score: 1 },
          { label: "D", text: "우선순위가 낮다고 본다", score: 2 },
        ],
      },
      {
        questionId: "Q6",
        category: "economy",
        questionText: "‘노력해도 삶이 크게 나아지지 않는다’는 인식이 퍼진다면?",
        options: [
          { label: "A", text: "사회 구조 전반의 조정이 필요하다", score: -2 },
          { label: "B", text: "정부의 역할 확대를 검토할 수 있다", score: -1 },
          { label: "C", text: "개인 노력과 환경이 함께 작용한다", score: 1 },
          { label: "D", text: "개인 선택의 영향이 크다고 본다", score: 2 },
        ],
      },

      // 사회 파트 (Q7-Q12)
      {
        questionId: "Q7",
        category: "society",
        questionText: "사회 전반에서 새로운 가치와 변화가 빠르게 등장할 때?",
        options: [
          { label: "A", text: "빠른 변화는 자연스러운 흐름이다", score: -2 },
          { label: "B", text: "점진적으로 적응해 나가면 된다", score: -1 },
          { label: "C", text: "변화 속도를 조절할 필요가 있다", score: 1 },
          { label: "D", text: "안정과 전통을 중시해야 한다", score: 2 },
        ],
      },
      {
        questionId: "Q8",
        category: "society",
        questionText: "정체성 문제로 차별을 호소하는 사례를 접한다면?",
        options: [
          { label: "A", text: "법과 제도를 통한 보호가 필요하다", score: -2 },
          { label: "B", text: "기본적인 보호 장치는 마련되어야 한다", score: -1 },
          { label: "C", text: "사회적 합의를 거쳐 접근해야 한다", score: 1 },
          { label: "D", text: "제도 개입은 신중해야 한다", score: 2 },
        ],
      },
      {
        questionId: "Q9",
        category: "society",
        questionText: "결혼과 가족 형태가 다양해지는 사회에 대해?",
        options: [
          { label: "A", text: "다양한 형태가 동등하게 존중받아야 한다", score: -2 },
          { label: "B", text: "존중하되 사회적 기준도 고려해야 한다", score: -1 },
          { label: "C", text: "기존 가족 형태의 역할이 중요하다", score: 1 },
          { label: "D", text: "전통적 가족 구조가 중심이 되어야 한다", score: 2 },
        ],
      },
      {
        questionId: "Q10",
        category: "society",
        questionText: "학교에서 인성·생활 교육을 강화하자는 의견에 대해?",
        options: [
          { label: "A", text: "개인의 선택에 맡기는 것이 바람직하다", score: -2 },
          { label: "B", text: "기본적인 기준만 마련하면 된다", score: -1 },
          { label: "C", text: "학교의 주요 역할 중 하나라고 본다", score: 1 },
          { label: "D", text: "교육의 핵심 요소로 강화해야 한다", score: 2 },
        ],
      },
      {
        questionId: "Q11",
        category: "society",
        questionText: "온라인에서 과격한 표현이 늘어나는 현상을 본다면?",
        options: [
          { label: "A", text: "표현의 자유를 최대한 보장해야 한다", score: -2 },
          { label: "B", text: "최소한의 기준만 필요하다", score: -1 },
          { label: "C", text: "일정 수준의 제한이 필요하다", score: 1 },
          { label: "D", text: "강한 규제가 필요하다고 본다", score: 2 },
        ],
      },
      {
        questionId: "Q12",
        category: "society",
        questionText: "사회적 갈등이 발생했을 때 더 적절한 접근은?",
        options: [
          { label: "A", text: "소수 의견 보호를 우선 고려해야 한다", score: -2 },
          { label: "B", text: "이해관계의 균형을 맞춰야 한다", score: -1 },
          { label: "C", text: "다수의 판단을 존중해야 한다", score: 1 },
          { label: "D", text: "질서 유지를 최우선으로 봐야 한다", score: 2 },
        ],
      },

      // 정부 역할 파트 (Q13-Q18)
      {
        questionId: "Q13",
        category: "government",
        questionText: "경제 상황이 악화될 때 정부의 역할로 더 가까운 생각은?",
        options: [
          { label: "A", text: "적극적인 개입이 필요하다", score: -2 },
          { label: "B", text: "필요한 범위 내에서 개입해야 한다", score: -1 },
          { label: "C", text: "최소한의 개입이 적절하다", score: 1 },
          { label: "D", text: "시장 기능에 맡기는 것이 낫다", score: 2 },
        ],
      },
      {
        questionId: "Q14",
        category: "government",
        questionText: "생활 필수 서비스의 운영 방식으로 더 적절한 것은?",
        options: [
          { label: "A", text: "국가가 직접 운영하는 것이 바람직하다", score: -2 },
          { label: "B", text: "공공 중심에 민간을 보완적으로 활용", score: -1 },
          { label: "C", text: "민간 경쟁을 통해 효율을 높인다", score: 1 },
          { label: "D", text: "민간 중심 운영이 낫다", score: 2 },
        ],
      },
      {
        questionId: "Q15",
        category: "government",
        questionText: "새로운 규제가 도입될 때의 기본적인 생각은?",
        options: [
          { label: "A", text: "공익을 위해 필요하다고 본다", score: -2 },
          { label: "B", text: "최소한의 규제라면 수용 가능하다", score: -1 },
          { label: "C", text: "규제는 줄이는 방향이 낫다", score: 1 },
          { label: "D", text: "규제는 성장을 제한할 수 있다", score: 2 },
        ],
      },
      {
        questionId: "Q16",
        category: "government",
        questionText: "국가 예산 운영에서 더 중요하게 보는 것은?",
        options: [
          { label: "A", text: "필요한 분야에 적극적으로 투자", score: -2 },
          { label: "B", text: "선별적 지출이 바람직하다", score: -1 },
          { label: "C", text: "지출과 절약의 균형", score: 1 },
          { label: "D", text: "재정 건전성 유지", score: 2 },
        ],
      },
      {
        questionId: "Q17",
        category: "government",
        questionText: "병원비 부담을 완화하는 방식으로 더 가까운 생각은?",
        options: [
          { label: "A", text: "공공의료 확대가 필요하다", score: -2 },
          { label: "B", text: "점진적 확대가 적절하다", score: -1 },
          { label: "C", text: "현 구조를 유지하는 것이 낫다", score: 1 },
          { label: "D", text: "민간 중심이 효율적이다", score: 2 },
        ],
      },
      {
        questionId: "Q18",
        category: "government",
        questionText: "정책 실패의 위험으로 더 크게 느껴지는 것은?",
        options: [
          { label: "A", text: "시장 기능의 한계", score: -2 },
          { label: "B", text: "시장 조정 실패", score: -1 },
          { label: "C", text: "정부의 비효율", score: 1 },
          { label: "D", text: "과도한 정부 개입", score: 2 },
        ],
      },

      // 안보 파트 (Q19-Q24)
      {
        questionId: "Q19",
        category: "security",
        questionText: "군사적 긴장이 높아졌을 때 더 안정적이라 느끼는 대응은?",
        options: [
          { label: "A", text: "대화와 협력을 우선 시도", score: -2 },
          { label: "B", text: "대화와 대비를 병행", score: -1 },
          { label: "C", text: "억지력 강화를 중시", score: 1 },
          { label: "D", text: "강경한 대응이 필요", score: 2 },
        ],
      },
      {
        questionId: "Q20",
        category: "security",
        questionText: "국방 예산 확대 논의에 대해?",
        options: [
          { label: "A", text: "다른 분야를 우선 고려", score: -2 },
          { label: "B", text: "제한적인 증액은 필요", score: -1 },
          { label: "C", text: "상황에 맞춘 증액 필요", score: 1 },
          { label: "D", text: "적극적인 증액이 필요", score: 2 },
        ],
      },
      {
        questionId: "Q21",
        category: "security",
        questionText: "법 집행에서 더 중요하다고 보는 기준은?",
        options: [
          { label: "A", text: "인권과 상황을 고려한 판단", score: -2 },
          { label: "B", text: "원칙과 유연성의 균형", score: -1 },
          { label: "C", text: "법과 원칙의 일관성", score: 1 },
          { label: "D", text: "엄격한 기준 적용", score: 2 },
        ],
      },
      {
        questionId: "Q22",
        category: "security",
        questionText: "대규모 집회·시위에 대한 기본적인 입장은?",
        options: [
          { label: "A", text: "폭넓게 보장되어야 한다", score: -2 },
          { label: "B", text: "조건을 두고 허용하는 것이 적절", score: -1 },
          { label: "C", text: "질서 유지를 우선 고려", score: 1 },
          { label: "D", text: "공공질서 관리 강화 필요", score: 2 },
        ],
      },
      {
        questionId: "Q23",
        category: "security",
        questionText: "강력 범죄 대응 방식으로 더 효과적이라 보는 것은?",
        options: [
          { label: "A", text: "예방과 재활 중심 접근", score: -2 },
          { label: "B", text: "예방과 처벌의 병행", score: -1 },
          { label: "C", text: "처벌 강화 중심", score: 1 },
          { label: "D", text: "강력한 처벌 강화", score: 2 },
        ],
      },
      {
        questionId: "Q24",
        category: "security",
        questionText: "자유와 안전이 충돌할 때 더 우선해야 한다고 느끼는 것은?",
        options: [
          { label: "A", text: "자유를 우선 고려해야 한다", score: -2 },
          { label: "B", text: "자유를 조금 더 중시", score: -1 },
          { label: "C", text: "안전을 조금 더 중시", score: 1 },
          { label: "D", text: "안전을 우선해야 한다", score: 2 },
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
}

// 독립 실행용 함수 (npm run seed:questions 용)
async function seedQuestions() {
  try {
    await client.connect();
    console.log("✅ MongoDB 연결 성공");

    const db = client.db("kpolitics");
    const collection = db.collection("politicalTestQuestions");

    await seedQuestionsData(collection);
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
