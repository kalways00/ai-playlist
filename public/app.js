// 전역 변수
let chart = null;
let currentStocks = [];
let activeStock = null;

// 로컬 스토리지 키
const STORAGE_KEY = 'stock_analysis_cache';

// DOM 요소
const searchForm = document.getElementById('searchForm');
const stockInput = document.getElementById('stockInput');
const stockInfo = document.getElementById('stockInfo');
const stockTabs = document.getElementById('stockTabs');
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const closeBtn = document.getElementById('closeBtn');
const analysisContent = document.getElementById('analysisContent');
const analysisText = document.getElementById('analysisText');
const analysisLoading = document.getElementById('analysisLoading');

// 이벤트 리스너
searchForm.addEventListener('submit', handleSearch);
closeBtn.addEventListener('click', hideStockInfo);

// 탭 전환 이벤트
document.querySelectorAll('.content-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    const targetTab = e.target.dataset.tab;
    switchTab(targetTab);
  });
});

// 차트 버튼 이벤트
document.querySelectorAll('.chart-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    // 리셋 버튼이 아닌 경우에만 활성화 상태 변경
    if (!e.target.id || e.target.id !== 'resetZoomBtn') {
      document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      if (activeStock) {
        loadChartData(activeStock.name, e.target.dataset.period);
      }
    }
  });
});

// 줌 리셋 버튼 이벤트
document.getElementById('resetZoomBtn').addEventListener('click', () => {
  if (chart) {
    chart.resetZoom();
  }
});

// 탭 전환 함수
function switchTab(tabName) {
  // 탭 버튼 활성화 상태 변경
  document.querySelectorAll('.content-tab').forEach(tab => {
    if (tab.dataset.tab === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // 탭 컨텐츠 표시 변경
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });

  if (tabName === 'chart') {
    document.getElementById('chartTab').classList.add('active');
  } else if (tabName === 'analysis') {
    document.getElementById('analysisTab').classList.add('active');
  }
}

// 검색 처리 (엔터키)
async function handleSearch(e) {
  e.preventDefault();
  const query = stockInput.value.trim();

  if (!query) {
    showError('종목코드 또는 종목명을 입력해주세요');
    return;
  }

  // 웰컴 스크린 숨기고 로딩 표시
  document.getElementById('welcomeScreen').classList.add('hidden');
  showLoading();
  hideError();

  try {
    // 종목 검색
    const stockData = await searchStock(query);

    if (!stockData) {
      showError('종목을 찾을 수 없습니다');
      hideLoading();
      document.getElementById('welcomeScreen').classList.remove('hidden');
      return;
    }

    // 탭에 추가
    addStockTab(stockData);

    // 상세 정보 표시
    await displayStockInfo(stockData);

    // 검색창 초기화
    stockInput.value = '';

  } catch (err) {
    console.error('Error:', err);
    showError('데이터를 불러오는 중 오류가 발생했습니다: ' + err.message);
    document.getElementById('welcomeScreen').classList.remove('hidden');
  } finally {
    hideLoading();
  }
}

// 종목 검색
async function searchStock(query) {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || '검색 실패');
  }

  return await response.json();
}

// 주식 상세 정보 표시
async function displayStockInfo(stockData) {
  activeStock = stockData;

  // 저장된 AI 분석 불러오기
  loadCachedAnalysis(stockData.code);

  // 기본 정보 표시
  document.getElementById('stockName').textContent = stockData.name;
  document.getElementById('stockCode').textContent = stockData.code;
  document.getElementById('currentPrice').textContent = formatPrice(stockData.price);

  // 등락 정보
  const change = stockData.change;
  const changeRate = stockData.changeRate;
  const isPositive = change >= 0;

  const changeEl = document.getElementById('priceChange');
  const changeRateEl = document.getElementById('changeRate');

  changeEl.textContent = (isPositive ? '+' : '') + formatPrice(change);
  changeRateEl.textContent = `(${isPositive ? '+' : ''}${changeRate.toFixed(2)}%)`;

  changeEl.className = isPositive ? 'change positive' : 'change negative';
  changeRateEl.className = isPositive ? 'change-rate positive' : 'change-rate negative';

  // 상세 정보
  document.getElementById('openPrice').textContent = formatPrice(stockData.open);
  document.getElementById('highPrice').textContent = formatPrice(stockData.high);
  document.getElementById('lowPrice').textContent = formatPrice(stockData.low);
  document.getElementById('volume').textContent = formatVolume(stockData.volume);

  // 차트 로드
  await loadChartData(stockData.name, 'D');

  // AI 분석 자동 실행 (캐시된 분석이 없는 경우에만)
  if (!getCachedAnalysis(stockData.code)) {
    performAnalysis();
  }

  // 주식 정보 표시 (웰컴 스크린은 이미 handleSearch에서 숨김)
  stockInfo.classList.remove('hidden');
}

// 차트 데이터 로드
async function loadChartData(code, period = 'D') {
  try {
    const response = await fetch('/api/chart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, period })
    });

    if (!response.ok) {
      throw new Error('차트 데이터 로드 실패');
    }

    const chartData = await response.json();
    renderChart(chartData);

  } catch (err) {
    console.error('Chart error:', err);
    showError('차트를 불러올 수 없습니다');
  }
}

// 차트 렌더링 (캔들스틱)
function renderChart(data) {
  const ctx = document.getElementById('stockChart').getContext('2d');

  if (chart) {
    chart.destroy();
  }

  // OHLC 데이터를 날짜 형식으로 변환 (유효한 데이터만 필터링)
  const validData = data.ohlc.filter(item => {
    // 0값이거나 유효하지 않은 데이터 제외
    return item.o > 0 && item.h > 0 && item.l > 0 && item.c > 0;
  });

  // 인덱스 기반으로 변환하고 라벨 생성
  const candlestickData = validData.map((item, index) => {
    return {
      x: index, // 인덱스 사용
      o: item.o,
      h: item.h,
      l: item.l,
      c: item.c
    };
  });

  // x축 라벨 생성
  const labels = validData.map(item => {
    const dateStr = item.x;
    return `${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}`;
  });

  chart = new Chart(ctx, {
    type: 'candlestick',
    data: {
      labels: labels,
      datasets: [{
        label: '주가',
        data: candlestickData,
        color: {
          up: '#ff0000',      // 상승 봉 색상 (순수 빨강)
          down: '#0000ff',    // 하락 봉 색상 (순수 파랑)
          unchanged: '#808080' // 보합 봉 색상
        },
        borderColor: {
          up: '#ff0000',
          down: '#0000ff',
          unchanged: '#808080'
        }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            title: function(context) {
              // 인덱스를 날짜로 변환
              const index = context[0].dataIndex;
              return labels[index] || '';
            },
            label: function(context) {
              const point = context.raw;
              const change = point.c - point.o; // 등락
              const changeRate = point.o !== 0 ? ((change / point.o) * 100).toFixed(2) : '0.00'; // 등락률
              const changeSymbol = change >= 0 ? '+' : '';

              return [
                `시가: ₩${point.o.toLocaleString()}`,
                `고가: ₩${point.h.toLocaleString()}`,
                `저가: ₩${point.l.toLocaleString()}`,
                `종가: ₩${point.c.toLocaleString()}`,
                `등락: ${changeSymbol}₩${change.toLocaleString()} (${changeSymbol}${changeRate}%)`
              ];
            }
          }
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'x'
          },
          zoom: {
            wheel: {
              enabled: true
            },
            pinch: {
              enabled: true
            },
            mode: 'x'
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          ticks: {
            maxTicksLimit: 20,
            callback: function(value) {
              // 인덱스를 라벨로 변환
              return labels[Math.floor(value)] || '';
            }
          }
        },
        y: {
          ticks: {
            callback: function(value) {
              return '₩' + value.toLocaleString();
            }
          }
        }
      }
    }
  });
}

// 탭 추가
function addStockTab(stockData) {
  // 이미 있는지 확인
  const existing = currentStocks.find(s => s.code === stockData.code);
  if (existing) {
    selectTab(stockData.code);
    return;
  }

  currentStocks.push(stockData);

  const tab = document.createElement('div');
  tab.className = 'tab active';
  tab.dataset.code = stockData.code;
  tab.innerHTML = `
    <span>${stockData.name}</span>
    <span class="tab-close">✕</span>
  `;

  // 탭 클릭
  tab.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) {
      removeTab(stockData.code);
    } else {
      selectTab(stockData.code);
      displayStockInfo(stockData);
    }
  });

  // 다른 탭 비활성화
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

  stockTabs.appendChild(tab);
}

// 탭 선택
function selectTab(code) {
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.code === code) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });

  const stock = currentStocks.find(s => s.code === code);
  if (stock) {
    displayStockInfo(stock);
  }
}

// 탭 제거
function removeTab(code) {
  currentStocks = currentStocks.filter(s => s.code !== code);
  const tab = document.querySelector(`.tab[data-code="${code}"]`);
  if (tab) {
    tab.remove();
  }

  if (currentStocks.length === 0) {
    hideStockInfo();
  } else if (activeStock?.code === code) {
    selectTab(currentStocks[0].code);
  }
}

// UI 헬퍼 함수
function showLoading() {
  loading.classList.remove('hidden');
}

function hideLoading() {
  loading.classList.add('hidden');
}

function showError(message) {
  error.textContent = message;
  error.classList.remove('hidden');
}

function hideError() {
  error.classList.add('hidden');
}

function hideStockInfo() {
  stockInfo.classList.add('hidden');
  document.getElementById('welcomeScreen').classList.remove('hidden');
  currentStocks = [];
  activeStock = null;
  stockTabs.innerHTML = '';
  if (chart) {
    chart.destroy();
    chart = null;
  }
}

// AI 분석 처리
async function performAnalysis() {
  if (!activeStock) {
    return;
  }

  // 로딩 표시
  analysisLoading.classList.remove('hidden');
  analysisContent.classList.add('hidden');

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: activeStock.code,
        name: activeStock.name,
        price: activeStock.price,
        change: activeStock.change,
        changeRate: activeStock.changeRate
      })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'AI 분석 실패');
    }

    const result = await response.json();

    // 마크다운을 HTML로 변환 (간단한 변환)
    const htmlContent = convertMarkdownToHtml(result.analysis);

    // 분석 결과 표시
    analysisText.innerHTML = htmlContent;
    analysisContent.classList.remove('hidden');

    // 로컬 스토리지에 저장
    saveAnalysisToCache(activeStock.code, result.analysis);

  } catch (err) {
    console.error('Analysis error:', err);
    analysisText.innerHTML = '<p>AI 분석 중 오류가 발생했습니다.</p>';
    analysisContent.classList.remove('hidden');
  } finally {
    analysisLoading.classList.add('hidden');
  }
}

// 로컬 스토리지에서 분석 캐시 가져오기
function getCachedAnalysis(code) {
  try {
    const cache = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const cached = cache[code];

    if (!cached) {
      return null;
    }

    // 오늘 날짜 확인
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // 저장된 날짜와 오늘 날짜가 다르면 캐시 무효화
    if (cached.date !== today) {
      // 해당 종목의 캐시 삭제
      delete cache[code];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      return null;
    }

    return cached.analysis;
  } catch (e) {
    return null;
  }
}

// 로컬 스토리지에 분석 저장
function saveAnalysisToCache(code, analysis) {
  try {
    const cache = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    cache[code] = {
      analysis: analysis,
      date: today
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error('Failed to save analysis to cache:', e);
  }
}

// 캐시된 분석 불러오기
function loadCachedAnalysis(code) {
  const cachedAnalysis = getCachedAnalysis(code);

  if (cachedAnalysis) {
    // 캐시된 분석 표시
    const htmlContent = convertMarkdownToHtml(cachedAnalysis);
    analysisText.innerHTML = htmlContent;
    analysisContent.classList.remove('hidden');
    analysisLoading.classList.add('hidden');
  } else {
    // 캐시가 없으면 초기화
    analysisText.innerHTML = '';
    analysisContent.classList.add('hidden');
    analysisLoading.classList.remove('hidden');
  }
}

// 간단한 마크다운 → HTML 변환
function convertMarkdownToHtml(markdown) {
  let html = markdown;

  // ## 헤딩 변환
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');

  // 줄바꿈 처리
  html = html.split('\n\n').map(para => {
    if (para.startsWith('<h2>')) {
      return para;
    }
    return '<p>' + para.replace(/\n/g, '<br>') + '</p>';
  }).join('\n');

  // 리스트 처리 (간단한 버전)
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  return html;
}

// 포맷팅 함수
function formatPrice(price) {
  return '₩' + Math.round(price).toLocaleString();
}

function formatVolume(volume) {
  if (volume >= 1000000) {
    return (volume / 1000000).toFixed(1) + 'M';
  } else if (volume >= 1000) {
    return (volume / 1000).toFixed(1) + 'K';
  }
  return volume.toLocaleString();
}

// 추천 주식 로드
async function loadRecommendedStocks() {
  const recommendedStocksEl = document.getElementById('recommendedStocks');

  try {
    const response = await fetch('/api/recommended');

    if (!response.ok) {
      throw new Error('추천 주식 조회 실패');
    }

    const data = await response.json();

    if (data.stocks && data.stocks.length > 0) {
      // 모든 종목 표시
      recommendedStocksEl.innerHTML = data.stocks.map((stock, index) => `
        <div class="recommended-stock" data-stock-name="${stock.name}">
          <div style="display: flex; align-items: center; margin-bottom: 4px;">
            <span class="recommended-rank">${index + 1}</span>
            <div style="flex: 1;">
              <div class="recommended-name">${stock.name}</div>
              <div class="recommended-code">${stock.code}</div>
            </div>
          </div>
          <div class="recommended-reason">
            💡 ${stock.reason || '시장 상황에 따른 급등'}<br>
            🔥 등락률: <strong style="color: #e74c3c;">+${stock.growthRate}%</strong><br>
            💰 현재가: ${formatPrice(stock.currentPrice)}
          </div>
        </div>
      `).join('');

      // 클릭 이벤트 추가
      document.querySelectorAll('.recommended-stock').forEach(stockEl => {
        stockEl.addEventListener('click', () => {
          const stockName = stockEl.dataset.stockName;
          stockInput.value = stockName;
          handleSearch({ preventDefault: () => {} });
        });
      });
    } else {
      recommendedStocksEl.innerHTML = `
        <div style="text-align: center; color: #666; padding: 20px; font-size: 13px;">
          현재 등락률 20% 이상 종목이 없습니다
        </div>
      `;
    }
  } catch (err) {
    console.error('Failed to load recommended stocks:', err);
    recommendedStocksEl.innerHTML = `
      <div style="text-align: center; color: #999; padding: 20px; font-size: 13px;">
        추천 주식을 불러올 수 없습니다
      </div>
    `;
  }
}

// 페이지 로드 시 추천 주식 로드
loadRecommendedStocks();
