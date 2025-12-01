import { Hono } from "hono";
import { GoogleGenAI } from "@google/genai";

type Env = {
  DATA_GO_KR_API_KEY: string;
  GEMINI_API_KEY: string;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Env }>();

// 공공데이터포털 금융위원회 주식시세정보 API
const DATA_GO_KR_BASE_URL =
  "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo";

// Gemini AI 헬퍼 함수
async function generateWithGemini(
  apiKey: string,
  prompt: string
): Promise<string | null> {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt
    });
    return response.text || null;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return null;
  }
}

// API: 종목 검색
app.post("/api/search", async (c) => {
  try {
    const { query } = await c.req.json();
    const normalizedQuery = query?.trim();
    console.log(
      "Received query:",
      normalizedQuery,
      "Type:",
      typeof normalizedQuery
    );

    if (!normalizedQuery) {
      return c.json({ error: "검색어를 입력해주세요" }, 400);
    }

    const apiKey = c.env.DATA_GO_KR_API_KEY;

    if (!apiKey) {
      return c.json({ error: "API 키가 설정되지 않았습니다" }, 500);
    }

    // 최근 영업일 날짜 계산 (어제부터 시작)
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() - 1); // 어제

    // 2024년 대한민국 공휴일 목록
    const holidays2024 = [
      "20240101",
      "20240209",
      "20240210",
      "20240211",
      "20240212", // 설날
      "20240301", // 삼일절
      "20240410", // 총선
      "20240505", // 어린이날
      "20240506", // 대체공휴일
      "20240515", // 부처님오신날
      "20240606", // 현충일
      "20240815", // 광복절
      "20240916",
      "20240917",
      "20240918", // 추석
      "20241003", // 개천절
      "20241009", // 한글날
      "20241225" // 크리스마스
    ];

    // 주말 및 공휴일 제외
    let dateStr = targetDate.toISOString().slice(0, 10).replace(/-/g, "");
    while (
      targetDate.getDay() === 0 ||
      targetDate.getDay() === 6 ||
      holidays2024.includes(dateStr)
    ) {
      targetDate.setDate(targetDate.getDate() - 1);
      dateStr = targetDate.toISOString().slice(0, 10).replace(/-/g, "");
    }

    const basDt = targetDate.toISOString().slice(0, 10).replace(/-/g, "");

    // 공공데이터 API로 주식 시세 조회
    // itmsNm: 종목명, likeSrtnCd: 종목코드 (둘 다 사용 가능)
    const url = `${DATA_GO_KR_BASE_URL}?serviceKey=${apiKey}&resultType=json&basDt=${basDt}&itmsNm=${encodeURIComponent(
      normalizedQuery
    )}`;

    const quoteResponse = await fetch(url);

    if (!quoteResponse.ok) {
      throw new Error("시세 조회 실패");
    }

    const responseData = (await quoteResponse.json()) as any;
    console.log(
      "공공데이터 API Response:",
      JSON.stringify(responseData, null, 2)
    );

    const items = responseData.response?.body?.items?.item;

    if (!items || items.length === 0) {
      return c.json({ error: "시세 데이터를 찾을 수 없습니다" }, 404);
    }

    // 첫 번째 항목 사용
    const item = Array.isArray(items) ? items[0] : items;

    const clpr = parseFloat(item.clpr || 0); // 종가
    const vs = parseFloat(item.vs || 0); // 대비
    const fltRt = parseFloat(item.fltRt || 0); // 등락률

    return c.json({
      code: item.srtnCd || normalizedQuery, // 종목코드
      name: item.itmsNm || normalizedQuery, // 종목명
      price: clpr,
      change: vs,
      changeRate: fltRt,
      open: parseFloat(item.mkp || 0), // 시가
      high: parseFloat(item.hipr || 0), // 고가
      low: parseFloat(item.lopr || 0), // 저가
      volume: parseInt(item.trqu || 0) // 거래량
    });
  } catch (error) {
    console.error("Search Error:", error);
    return c.json({ error: "검색 중 오류가 발생했습니다" }, 500);
  }
});

// API: 차트 데이터
app.post("/api/chart", async (c) => {
  try {
    const { code, period = "D" } = await c.req.json();

    if (!code) {
      return c.json({ error: "종목명이 필요합니다" }, 400);
    }

    const apiKey = c.env.DATA_GO_KR_API_KEY;

    if (!apiKey) {
      return c.json({ error: "API 키가 설정되지 않았습니다" }, 500);
    }

    // 기간 설정 (최근 10개월 데이터)
    const endDate = new Date();
    const startDate = new Date();

    // 기간에 따라 시작 날짜 조정
    if (period === "W") {
      startDate.setMonth(startDate.getMonth() - 10); // 10개월
    } else if (period === "M") {
      startDate.setMonth(startDate.getMonth() - 10); // 10개월
    } else {
      startDate.setMonth(startDate.getMonth() - 10); // 10개월
    }

    const beginBasDt = startDate.toISOString().slice(0, 10).replace(/-/g, "");
    const endBasDt = endDate.toISOString().slice(0, 10).replace(/-/g, "");

    // 공공데이터 API로 차트 데이터 조회 (입력값 그대로 사용)
    const url = `${DATA_GO_KR_BASE_URL}?serviceKey=${apiKey}&resultType=json&beginBasDt=${beginBasDt}&endBasDt=${endBasDt}&itmsNm=${encodeURIComponent(
      code
    )}&numOfRows=300`;

    const chartResponse = await fetch(url);

    if (!chartResponse.ok) {
      throw new Error("차트 데이터 조회 실패");
    }

    const responseData = (await chartResponse.json()) as any;

    const items = responseData.response?.body?.items?.item;

    if (!items || items.length === 0) {
      return c.json({ ohlc: [] });
    }

    // 배열로 변환
    const dataArray = Array.isArray(items) ? items : [items];

    // 날짜순 정렬 (전체 데이터 사용)
    const sortedData = dataArray.sort((a: any, b: any) =>
      a.basDt.localeCompare(b.basDt)
    );

    // OHLC 데이터 포맷으로 변환 (캔들스틱용)
    const ohlcData = sortedData.map((item: any) => ({
      x: item.basDt, // YYYYMMDD 형식
      o: parseFloat(item.mkp || 0), // 시가 (Open)
      h: parseFloat(item.hipr || 0), // 고가 (High)
      l: parseFloat(item.lopr || 0), // 저가 (Low)
      c: parseFloat(item.clpr || 0) // 종가 (Close)
    }));

    return c.json({
      ohlc: ohlcData
    });
  } catch (error) {
    console.error("Chart Error:", error);
    return c.json({ error: "차트 조회 중 오류가 발생했습니다" }, 500);
  }
});

// API: AI 분석 (기업 정보 요약 및 주가 예측)
app.post("/api/analyze", async (c) => {
  try {
    const { code, name, price, change, changeRate } = await c.req.json();

    if (!code || !name) {
      return c.json({ error: "종목 정보가 필요합니다" }, 400);
    }

    const apiKey = c.env.GEMINI_API_KEY;

    if (!apiKey) {
      return c.json({ error: "Gemini API 키가 설정되지 않았습니다" }, 500);
    }

    // Gemini API로 분석 요청
    const prompt = `당신은 주식 투자 전문가입니다. 다음 한국 기업에 대해 분석해주세요:

기업명: ${name}
종목코드: ${code}
현재가: ${price?.toLocaleString()}원
전일대비: ${change > 0 ? "+" : ""}${change?.toLocaleString()}원 (${
      changeRate > 0 ? "+" : ""
    }${changeRate}%)

다음 형식으로 답변해주세요:

## 기업 개요
(기업의 주요 사업 분야와 특징을 2-3문장으로 요약)

## 최근 동향
(최근 기업의 주요 이슈나 실적 동향을 2-3문장으로 요약)

## 투자 포인트
(긍정적 요인과 부정적 요인을 각각 2-3가지씩 간단히 나열)

## 주가 전망
(향후 주가 전망을 단기/중기로 나누어 2-3문장으로 설명. 단, 이는 참고용이며 투자 판단은 본인의 책임임을 명시)`;

    const analysis = await generateWithGemini(apiKey, prompt);

    if (!analysis) {
      return c.json({ error: "AI 분석 결과를 가져올 수 없습니다" }, 500);
    }

    return c.json({
      analysis
    });
  } catch (error) {
    console.error("AI Analysis Error:", error);
    return c.json({ error: "AI 분석 중 오류가 발생했습니다" }, 500);
  }
});

// API: 추천 주식 (등락률 20% 이상 상위 5개)
app.get("/api/recommended", async (c) => {
  try {
    const apiKey = c.env.DATA_GO_KR_API_KEY;

    if (!apiKey) {
      return c.json({ error: "API 키가 설정되지 않았습니다" }, 500);
    }

    // 최근 영업일 날짜 계산
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() - 1); // 어제

    // 2024년 대한민국 공휴일 목록
    const holidays2024 = [
      "20240101",
      "20240209",
      "20240210",
      "20240211",
      "20240212",
      "20240301",
      "20240410",
      "20240505",
      "20240506",
      "20240515",
      "20240606",
      "20240815",
      "20240916",
      "20240917",
      "20240918",
      "20241003",
      "20241009",
      "20241225"
    ];

    // 주말 및 공휴일 제외
    let dateStr = targetDate.toISOString().slice(0, 10).replace(/-/g, "");
    while (
      targetDate.getDay() === 0 ||
      targetDate.getDay() === 6 ||
      holidays2024.includes(dateStr)
    ) {
      targetDate.setDate(targetDate.getDate() - 1);
      dateStr = targetDate.toISOString().slice(0, 10).replace(/-/g, "");
    }

    const basDt = targetDate.toISOString().slice(0, 10).replace(/-/g, "");

    // 등락률 20% 이상 종목 5개 조회
    const url = `${DATA_GO_KR_BASE_URL}?serviceKey=${apiKey}&resultType=json&basDt=${basDt}&beginFltRt=20&numOfRows=5`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("추천 주식 조회 실패");
    }

    const responseData = (await response.json()) as any;
    const items = responseData.response?.body?.items?.item;

    if (!items || items.length === 0) {
      return c.json({ stocks: [], count: 0 });
    }

    // 배열로 변환
    const dataArray = Array.isArray(items) ? items : [items];

    // Gemini API로 각 종목의 급등 이유 분석
    const geminiApiKey = c.env.GEMINI_API_KEY;

    const stocksWithReasons = await Promise.all(
      dataArray.map(async (item: any) => {
        let reason = "시장 상황에 따른 급등";

        if (geminiApiKey) {
          try {
            const prompt = `${item.itmsNm} 종목이 ${parseFloat(
              item.fltRt || 0
            ).toFixed(
              2
            )}% 급등했습니다. 이 종목의 급등 이유를 한 문장(20자 이내)으로 간단히 설명해주세요. 구체적인 사업 분야나 최근 이슈 중심으로 작성해주세요.`;

            const aiReason = await generateWithGemini(geminiApiKey, prompt);
            if (aiReason) {
              reason = aiReason.trim().slice(0, 50); // 최대 50자로 제한
            }
          } catch (error) {
            console.error(`AI 분석 실패 (${item.itmsNm}):`, error);
          }
        }

        return {
          name: item.itmsNm,
          code: item.srtnCd,
          growthRate: parseFloat(item.fltRt || 0).toFixed(2),
          currentPrice: parseFloat(item.clpr || 0),
          change: parseFloat(item.vs || 0),
          changeRate: parseFloat(item.fltRt || 0),
          reason
        };
      })
    );

    return c.json({
      stocks: stocksWithReasons,
      count: stocksWithReasons.length
    });
  } catch (error) {
    console.error("Recommended Stock Error:", error);
    return c.json({ error: "추천 주식 조회 중 오류가 발생했습니다" }, 500);
  }
});

// 정적 파일 서빙 (맨 마지막에 위치)
app.get("/*", async (c) => {
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  return asset;
});

export default {
  fetch: app.fetch.bind(app)
};
