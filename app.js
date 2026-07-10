/* =====================================================================
 * Nemotron-Personas 추출기 (브라우저 전용)
 * - 국가별 Hugging Face 데이터셋의 실제 statistics/rows 메타를 읽어
 *   검색 항목을 자동 생성한다.
 * - 화면 표시는 한국어 라벨/번역값을 우선 사용하되, 수집 조건에는
 *   항상 소스 데이터의 원문 컬럼명/원문 값을 적용한다.
 * - Hugging Face /filter가 안정적으로 지원하는 정확 일치/범위 조건만
 *   서버에 보내고, 부분검색은 브라우저에서 후처리한다.
 * ===================================================================== */
"use strict";

// ---- 공통 설정 -------------------------------------------------------
const API = "https://datasets-server.huggingface.co";
const PAGE = 100;               // Dataset Viewer API의 안전한 요청 단위
const HARD_CAP = 1000;          // 최대 수집 인원
const CAT_MAX = 120;            // 고유값이 이 값 이하이면 실제 value_counts를 선택 목록으로 표시
const SCAN_MIN = 1000;
const SCAN_MAX = 300000;
const ANY_LABEL = "상관 없음";
const CAT_OR_MAX = 40;          // 범주 다중선택 OR 항목 상한 (초과 시 해당 조건 제외 + 경고)
const WHERE_MAX_LEN = 1900;     // where 인코딩 길이 가드 (URL 과다 방지)
const CONC_ANON = 4;            // 스캔 동시성 (무토큰)
const CONC_TOKEN = 6;           // 스캔 동시성 (토큰)

// 데이터셋별 ILIKE(서버 부분검색) 지원 여부 캐시: true/false, 미검사면 없음
const ILIKE_SUPPORT = new Map();

// 국가별 데이터 소스 + 수집 환경 프로필
const COUNTRIES = [
  {
    name: "한국", dataset: "nvidia/Nemotron-Personas-Korea", size: "700만 명 · Korean",
    lang: "ko", scanDefault: 30000, defaultMode: "head",
    env: "한국어 원문값이 UI 언어와 일치합니다. 지역·학력·주거형태처럼 범주형 필터가 안정적으로 작동합니다."
  },
  {
    name: "미국", dataset: "nvidia/Nemotron-Personas-USA", size: "600만 명 · American English",
    lang: "en", scanDefault: 80000, defaultMode: "random",
    env: "영어 원문값 기준입니다. city·occupation처럼 고유값이 큰 항목은 원문 부분검색 후 브라우저에서 검증합니다."
  },
  {
    name: "일본", dataset: "nvidia/Nemotron-Personas-Japan", size: "600만 명 · Japanese",
    lang: "ja", scanDefault: 80000, defaultMode: "random",
    env: "일본어 원문값 기준입니다. 지역명·직업명은 실제 데이터 표기를 그대로 입력해야 가장 안정적입니다."
  },
  {
    name: "인도", dataset: "nvidia/Nemotron-Personas-India", size: "2,100만 명 · Hindi / Indian English",
    lang: "hi-en", scanDefault: 150000, defaultMode: "random",
    env: "데이터 규모가 가장 큽니다. Hindi와 Indian English 표기가 섞일 수 있어 무작위 구간 검색과 큰 검색 행 수를 기본으로 사용합니다."
  },
  {
    name: "싱가포르", dataset: "nvidia/Nemotron-Personas-Singapore", size: "88.8만 명 · English",
    lang: "en", scanDefault: 30000, defaultMode: "random",
    env: "영어 원문값 기준이며 규모가 작아 비교적 빠릅니다. 조건을 너무 좁히면 결과가 빨리 줄어들 수 있습니다."
  },
  {
    name: "브라질", dataset: "nvidia/Nemotron-Personas-Brazil", size: "600만 명 · Brazilian Portuguese",
    lang: "pt", scanDefault: 90000, defaultMode: "random",
    env: "브라질 포르투갈어 원문값 기준입니다. 악센트 차이는 완화하지만, 지역명은 원문 표기를 우선합니다."
  },
  {
    name: "프랑스", dataset: "nvidia/Nemotron-Personas-France", size: "600만 명 · French",
    lang: "fr", scanDefault: 90000, defaultMode: "random",
    env: "프랑스어 원문값 기준입니다. commune·department 등 현지 행정구역 컬럼을 실제 소스 구조대로 표시합니다."
  },
  {
    name: "엘살바도르", dataset: "nvidia/Nemotron-Personas-El-Salvador", size: "100만 명 · Salvadoran Spanish",
    lang: "es", scanDefault: 50000, defaultMode: "random",
    env: "스페인어 원문값 기준입니다. 작은 국가지만 지역·직업 표기는 현지어 입력이 안정적입니다."
  },
  {
    name: "베트남", dataset: "nvidia/Nemotron-Personas-Vietnam", size: "60만 명 · Vietnamese",
    lang: "vi", scanDefault: 40000, defaultMode: "random",
    env: "베트남어 원문값 기준입니다. 성조/악센트 차이는 최대한 완화해 비교합니다."
  },
  {
    name: "벨기에", dataset: "nvidia/Nemotron-Personas-Belgium", size: "30만 명",
    lang: "multi", scanDefault: 40000, defaultMode: "random",
    env: "다언어 국가 특성상 프랑스어·네덜란드어·영어식 표기가 섞일 수 있습니다. 원문값 선택 필터가 가장 안정적입니다."
  },
];

// 표시 라벨. 컬럼 존재 여부와 필터 항목 자체는 실제 소스 statistics에서 결정한다.
const LABELS = {
  uuid: "고유ID", id: "ID", person_id: "인물 ID",
  sex: "성별", gender: "성별", age: "나이", birth_year: "출생연도",
  marital_status: "혼인상태", relationship_status: "관계상태",
  military_status: "병역상태",
  education_level: "학력", education: "학력", highest_education: "최종학력",
  bachelors_field: "전공계열", field_of_study: "전공", major: "전공",
  occupation: "직업", job: "직업", employment_status: "고용상태", industry: "산업",
  family_type: "가족형태", household_type: "가구형태", housing_type: "주거형태",
  income: "소득", income_level: "소득수준",
  country: "국가", region: "지역", province: "시도/주", state: "주/지역",
  prefecture: "현", district: "구/군", sigungu: "시군구", sido: "시도",
  department: "데파르트망", commune: "코뮌", municipality: "지자체", city: "도시",
  county: "카운티", locality: "지역명", ward: "구역", neighborhood: "동네",
  zipcode: "우편번호", postal_code: "우편번호",
  persona: "페르소나 요약", professional_persona: "직업 페르소나",
  family_persona: "가족 페르소나", cultural_background: "문화적 배경",
  skills_and_expertise: "기술 및 전문성", hobbies_and_interests: "취미 및 관심사",
  career_goals_and_ambitions: "경력 목표", personality_traits: "성격 특성",
};

const DEMOGRAPHIC_PRIORITY = [
  "sex", "gender", "age", "marital_status", "military_status", "education_level", "education",
  "bachelors_field", "field_of_study", "occupation", "job", "employment_status",
  "family_type", "household_type", "housing_type", "income_level",
  "country", "region", "province", "state", "prefecture", "department", "district", "city",
  "municipality", "commune", "county", "locality", "ward", "neighborhood", "zipcode", "postal_code",
];

const PREFERRED_EXPORT_ORDER = [
  "uuid", "id", "person_id", "sex", "gender", "age", "marital_status", "military_status",
  "family_type", "household_type", "housing_type", "education_level", "education", "bachelors_field",
  "field_of_study", "occupation", "job", "employment_status", "industry",
  "country", "region", "province", "state", "prefecture", "department", "district", "city", "municipality", "commune",
  "persona", "professional_persona", "family_persona", "cultural_background",
];

const INTERNAL_COL_RE = /^(row_idx|__index_level_0__|index)$/i;
const ID_COL_RE = /^(uuid|id|person_id)$/i;
const LOCATION_COL_RE = /(country|region|province|state|prefecture|district|city|municipality|commune|county|locality|ward|neighborhood|zipcode|postal|sido|sigungu|department)/i;
const LONG_TEXT_COL_RE = /(persona|background|skills|hobbies|interests|goals|ambitions|description|bio|narrative|summary|traits|expertise)/i;

// ---- 상태 ------------------------------------------------------------
const state = {
  dataset: COUNTRIES[0].dataset,
  config: "default",
  split: "train",
  total: null,
  fields: [],
  category: {},       // { col: [원문값...] }
  contains: {},       // { col: "원문 검색어" }
  ranges: {},         // { col: { any, min, max, bounds:{min,max} } }
  lastRows: [],
  cancelRequested: false,
  activeController: null,
  isCollecting: false,
  userScanTouched: false,
};

// ---- DOM 헬퍼 --------------------------------------------------------
const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "title") n.title = v;
    else n.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return n;
}
function setBanner(msg, type) {
  const b = $("#banner");
  b.textContent = msg;
  b.className = "banner" + (type ? " " + type : "");
}
function setProgress(msg) { $("#progress").textContent = msg || ""; }
function currentCountry() { return COUNTRIES.find((x) => x.dataset === state.dataset) || COUNTRIES[0]; }
function fieldLabel(col) { return LABELS[col] || humanize(col); }
function humanize(col) {
  return String(col || "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

// ---- 한국어 표시 번역 ------------------------------------------------
const VALUE_TRANSLATIONS = new Map(Object.entries({
  // 성별
  "male": "남성", "m": "남성", "man": "남성", "homme": "남성", "masculino": "남성", "hombre": "남성", "nam": "남성", "男性": "남성", "男": "남성",
  "female": "여성", "f": "여성", "woman": "여성", "femme": "여성", "feminino": "여성", "mujer": "여성", "nữ": "여성", "女性": "여성", "女": "여성",
  "other": "기타", "non-binary": "논바이너리", "nonbinary": "논바이너리",

  // 혼인상태
  "single": "미혼", "unmarried": "미혼", "célibataire": "미혼", "solteiro": "미혼", "solteira": "미혼", "soltero": "미혼", "soltera": "미혼", "độc thân": "미혼", "未婚": "미혼", "独身": "미혼",
  "married": "기혼", "marié": "기혼", "mariée": "기혼", "casado": "기혼", "casada": "기혼", "đã kết hôn": "기혼", "既婚": "기혼",
  "divorced": "이혼", "divorcé": "이혼", "divorcée": "이혼", "divorciado": "이혼", "divorciada": "이혼", "ly hôn": "이혼", "離婚": "이혼",
  "widowed": "사별", "veuf": "사별", "veuve": "사별", "viúvo": "사별", "viúva": "사별", "viudo": "사별", "viuda": "사별", "góa": "사별", "死別": "사별",
  "separated": "별거", "separado": "별거", "separada": "별거", "séparé": "별거", "séparée": "별거",

  // 학력
  "no formal education": "무학", "less than high school": "고등학교 미만", "primary education": "초등교육", "middle school": "중학교", "secondary education": "중등교육",
  "high school": "고등학교", "high school diploma": "고등학교 졸업", "some college": "대학 일부", "associate degree": "전문학사",
  "bachelor's degree": "학사", "bachelors degree": "학사", "bachelor": "학사", "licence": "학사", "graduação": "학사", "licenciatura": "학사", "学士": "학사",
  "master's degree": "석사", "masters degree": "석사", "master": "석사", "maîtrise": "석사", "mestrado": "석사", "修士": "석사",
  "doctorate": "박사", "doctoral degree": "박사", "phd": "박사", "ph.d.": "박사", "doctorat": "박사", "doutorado": "박사", "博士": "박사",
  "vocational": "직업교육", "vocational training": "직업교육", "technical school": "기술학교",

  // 주거/가족
  "apartment": "아파트", "condo": "콘도", "condominium": "콘도", "house": "단독주택", "detached house": "단독주택", "townhouse": "타운하우스", "studio": "원룸", "rented": "임대", "owned": "자가", "owner": "자가", "tenant": "임차",
  "alone": "1인 가구", "single-person household": "1인 가구", "couple": "부부", "couple with children": "자녀가 있는 부부", "nuclear family": "핵가족", "extended family": "확대가족", "single parent": "한부모", "roommates": "룸메이트",

  // 고용/병역
  "employed": "재직", "unemployed": "실업", "self-employed": "자영업", "student": "학생", "retired": "은퇴", "homemaker": "전업주부/가사", "part-time": "파트타임", "full-time": "풀타임",
  "completed": "완료", "exempt": "면제", "not applicable": "해당 없음", "active duty": "현역", "served": "복무 완료", "veteran": "전역자",

  // 자주 쓰는 직업값 일부. 목록에 없는 직업은 원문 유지.
  "teacher": "교사", "engineer": "엔지니어", "software engineer": "소프트웨어 엔지니어", "developer": "개발자", "designer": "디자이너", "doctor": "의사", "nurse": "간호사", "lawyer": "변호사", "student": "학생", "professor": "교수", "manager": "관리자", "consultant": "컨설턴트", "accountant": "회계사", "salesperson": "영업직", "artist": "예술가", "researcher": "연구원", "chef": "요리사", "driver": "운전기사", "farmer": "농부", "retail worker": "소매업 종사자",

  // 예/아니오
  "yes": "예", "no": "아니오", "true": "예", "false": "아니오", "none": "없음", "unknown": "알 수 없음",
}));

function normalizeKey(v) {
  return String(v ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}
function displayValue(col, raw) {
  const s = String(raw ?? "");
  if (!s) return "빈 값";
  if (LOCATION_COL_RE.test(col)) return s; // 지역명/고유명사는 원문 유지
  const direct = VALUE_TRANSLATIONS.get(normalizeKey(s));
  return direct || s;
}

// ---- SQL / URL 빌더 --------------------------------------------------
const sqlStr = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const q = (col) => '"' + col.replace(/"/g, '""') + '"';

function categoryPredicates() {
  const preds = [], warnings = [];
  for (const [col, vals] of Object.entries(state.category)) {
    const arr = (vals || []).filter((x) => x !== "" && x != null);
    if (!arr.length) continue;
    if (arr.length > CAT_OR_MAX) { warnings.push(fieldLabel(col)); continue; }  // 너무 많이 선택 → 제외
    preds.push({ col, size: arr.length, sql: "(" + arr.map((v) => `${q(col)} = ${sqlStr(v)}`).join(" OR ") + ")" });
  }
  return { preds, warnings };
}
function rangePredicates() {
  const preds = [];
  for (const [col, r] of Object.entries(state.ranges)) {
    if (!r || r.any) continue;
    if (r.min !== "" && r.min != null && Number.isFinite(Number(r.min))) preds.push(`${q(col)} >= ${Number(r.min)}`);
    if (r.max !== "" && r.max != null && Number.isFinite(Number(r.max))) preds.push(`${q(col)} <= ${Number(r.max)}`);
  }
  return preds;
}
function assembleWhere(parts) { return parts.filter(Boolean).join(" AND "); }
// ILIKE 패턴: 와일드카드 문자(%,_)는 오작동 방지를 위해 공백 처리
function ilikePattern(text) { return "%" + String(text).replace(/[%_]/g, " ").trim() + "%"; }

function getClientContainsFilters() {
  return Object.entries(state.contains)
    .map(([col, text]) => ({ col, text: (text || "").trim() }))
    .filter((x) => x.text.length > 0);
}

function buildQueryPlan() {
  const warnings = [];
  const { preds: catPreds, warnings: catWarn } = categoryPredicates();
  if (catWarn.length) warnings.push(`선택 항목이 너무 많아 제외한 조건: ${catWarn.join(", ")}`);
  const rangeP = rangePredicates();
  const contains = getClientContainsFilters();

  // ILIKE 지원이 확인된 데이터셋이면 부분검색을 서버 조건으로 밀어넣는다.
  const serverContains = ILIKE_SUPPORT.get(state.dataset) === true;
  const containsPreds = serverContains
    ? contains.map((f) => `${q(f.col)} ILIKE ${sqlStr(ilikePattern(f.text))}`)
    : [];
  const clientFilters = serverContains ? [] : contains;

  let catSql = catPreds.map((p) => p.sql);
  let where = assembleWhere([...catSql, ...rangeP, ...containsPreds]);

  // where가 너무 길면 범주 조건을 '많이 선택한 것부터' 제거
  if (encodeURIComponent(where).length > WHERE_MAX_LEN && catPreds.length) {
    const sorted = [...catPreds].sort((a, b) => b.size - a.size);
    const dropped = [];
    while (encodeURIComponent(where).length > WHERE_MAX_LEN && sorted.length) {
      dropped.push(sorted.shift().col);
      catSql = sorted.map((p) => p.sql);
      where = assembleWhere([...catSql, ...rangeP, ...containsPreds]);
    }
    if (dropped.length) warnings.push(`조건이 너무 길어 제외한 범주: ${dropped.map(fieldLabel).join(", ")}`);
  }
  return { serverWhere: where, clientFilters, serverContainsUsed: serverContains && contains.length > 0, warnings };
}
function normText(v) {
  return String(v ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\-/,.;:()\[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function rowMatchesContains(row, filters) {
  if (!filters.length) return true;
  return filters.every(({ col, text }) => {
    const value = normText(row[col]);
    const query = normText(text);
    if (!query) return true;
    if (!value) return false;
    if (value.includes(query)) return true;
    const tokens = query.split(" ").filter(Boolean);
    return tokens.length > 1 && tokens.every((t) => value.includes(t));
  });
}
function buildUrl(where, offset, length) {
  const common =
    `dataset=${encodeURIComponent(state.dataset)}&config=${encodeURIComponent(state.config)}` +
    `&split=${encodeURIComponent(state.split)}&offset=${offset}&length=${length}`;
  return where && where.length
    ? `${API}/filter?${common}&where=${encodeURIComponent(where)}`
    : `${API}/rows?${common}`;
}

// ---- 네트워크 --------------------------------------------------------
function authHeaders() {
  const t = ($("#token")?.value || "").trim();
  return t ? { Authorization: "Bearer " + t } : {};
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function checkCancelled() {
  if (state.cancelRequested) throw new Error("수집이 취소되었습니다.");
}
function classifyHttp(status, body) {
  const b = (body || "").toLowerCase();
  if (status === 429) return "retry";
  if (status === 404) return "notfound";
  if (status === 401 || status === 403) return "auth";
  if (b.includes("loading") || b.includes("index") || b.includes("try again")) return "warming";
  if (status >= 500) return "retry";
  return "fatal";
}
async function fetchJson(url, opts = {}) {
  const { maxWaitMs = 120000, onWait = null, signal = null } = opts;
  const start = Date.now();
  let attempt = 0;
  while (true) {
    checkCancelled();
    attempt++;
    let status = 0, body = "", netErr = null;
    try {
      const res = await fetch(url, { headers: authHeaders(), mode: "cors", signal: signal || state.activeController?.signal });
      status = res.status;
      if (res.ok) return await res.json();
      body = await res.text().catch(() => "");
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("수집이 취소되었습니다.");
      netErr = e;
    }
    const kind = netErr ? "retry" : classifyHttp(status, body);
    if (kind === "notfound") throw new Error("데이터셋을 찾을 수 없습니다 (404). 저장소 이름을 확인하세요.");
    if (kind === "auth") throw new Error("접근 권한이 필요합니다. 고급 설정에서 HF 토큰을 입력해 보세요 (401/403).");
    if (kind === "fatal") throw new Error(`HTTP ${status} ${(body || "").slice(0, 180)}`);

    const elapsed = Date.now() - start;
    if (elapsed > maxWaitMs) {
      if (kind === "warming") throw new Error("데이터 색인 준비가 예상보다 오래 걸립니다. 1~2분 뒤 다시 시도해 주세요.");
      throw new Error(netErr ? ("네트워크 오류: " + netErr.message) : `HTTP ${status} ${(body || "").slice(0, 180)}`);
    }
    if (onWait) onWait({ warming: kind === "warming", sec: Math.round(elapsed / 1000), attempt });
    const backoff = kind === "warming" ? Math.min(2500 + attempt * 1000, 6500) : Math.min(700 * attempt, 4500);
    await sleep(backoff);
  }
}

// 단발성 상태 확인(재시도/폴백 판단용). 예외를 던지지 않고 상태코드만 반환.
async function rawProbe(url) {
  try {
    const res = await fetch(url, { headers: authHeaders(), mode: "cors", signal: state.activeController?.signal });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("수집이 취소되었습니다.");
    return { ok: false, status: 0 };
  }
}
// 해당 데이터셋의 /filter가 ILIKE(서버 부분검색)를 지원하는지 감지.
// true/false는 캐시, 불명확(색인 준비/네트워크)이면 null 반환 후 이번 실행은 클라이언트 스캔.
async function detectIlikeSupport(col) {
  if (ILIKE_SUPPORT.has(state.dataset)) return ILIKE_SUPPORT.get(state.dataset);
  const url = buildUrl(`${q(col)} ILIKE ${sqlStr("%a%")}`, 0, 1);
  const { ok, status } = await rawProbe(url);
  if (ok) { ILIKE_SUPPORT.set(state.dataset, true); return true; }
  if (status === 400 || status === 422) { ILIKE_SUPPORT.set(state.dataset, false); return false; }
  return null;
}

// ---- 데이터셋 메타 로드 ---------------------------------------------
async function resolveConfigSplit(dataset) {
  try {
    const s = await fetchJson(`${API}/splits?dataset=${encodeURIComponent(dataset)}`, { maxWaitMs: 30000 });
    const arr = s.splits || [];
    if (arr.length) {
      const t = arr.find((x) => x.split === "train") || arr[0];
      return { config: t.config, split: t.split };
    }
  } catch (e) { /* 기본값 사용 */ }
  return { config: "default", split: "train" };
}
function getColumnName(s) { return s.column_name || s.column || s.name || s.feature || ""; }
function getColumnStats(s) { return s.column_statistics || s.statistics || s.stats || {}; }
function getUniqueCount(cs, freq) {
  const n = cs.n_unique ?? cs.num_unique ?? cs.unique ?? cs.distinct_count;
  if (Number.isFinite(Number(n))) return Number(n);
  if (freq) return Object.keys(freq).length;
  return null;
}
function getMinMax(cs) {
  const min = cs.min ?? cs.minimum;
  const max = cs.max ?? cs.maximum;
  if (Number.isFinite(Number(min)) && Number.isFinite(Number(max))) return { min: Number(min), max: Number(max) };
  return null;
}
function normalizeFreq(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const obj = {};
    raw.forEach((it) => {
      if (Array.isArray(it) && it.length >= 2) obj[String(it[0])] = Number(it[1]) || 0;
      else if (it && typeof it === "object") {
        const val = it.value ?? it.name ?? it.key ?? it.label;
        const cnt = it.count ?? it.frequency ?? it.freq ?? it.n;
        if (val != null) obj[String(val)] = Number(cnt) || 0;
      }
    });
    return Object.keys(obj).length ? obj : null;
  }
  if (typeof raw === "object") return raw;
  return null;
}
function getFrequencies(cs) {
  // histogram(숫자 구간)은 범주값이 아니므로 제외한다. 값 분포가 명확한 것만 사용.
  return normalizeFreq(cs.frequencies || cs.value_counts || cs.top_values);
}
function isLikelyNumeric(col, cs, minMax) {
  if (/zip|postal|code/i.test(col)) return false;
  const t = String(cs.dtype || cs.type || cs.column_type || "").toLowerCase();
  if (col === "age" || /year|income|salary|amount|score|count|number/i.test(col)) return Boolean(minMax);
  if (/int|float|double|number|numeric/.test(t)) return Boolean(minMax);
  return Boolean(minMax && !ID_COL_RE.test(col) && !LOCATION_COL_RE.test(col));
}
function classifyField(col, cs, sourceIndex) {
  if (!col || INTERNAL_COL_RE.test(col)) return null;
  const freq = getFrequencies(cs);
  const uniqueCount = getUniqueCount(cs, freq);
  const minMax = getMinMax(cs);
  const nullCount = Number(cs.null_count ?? cs.n_missing ?? 0);
  const count = Number(cs.count ?? cs.n ?? cs.total ?? 0);
  if (uniqueCount === 0 || (count > 0 && nullCount >= count)) return null;

  if (isLikelyNumeric(col, cs, minMax)) {
    if (!minMax) return null;
    return { col, control: "range", bounds: minMax, sourceIndex, uniqueCount };
  }

  if (freq && uniqueCount != null && uniqueCount >= 1 && uniqueCount <= CAT_MAX) {
    const options = Object.keys(freq)
      .filter((v) => v != null && String(v).length)
      .sort((a, b) => String(a).localeCompare(String(b), "ko", { numeric: true, sensitivity: "base" }));
    return { col, control: "category", options, sourceIndex, uniqueCount };
  }

  // 고유값이 많거나 통계에 value_counts가 없는 문자열 컬럼도 실제 소스 컬럼으로 노출한다.
  // 단, ID 컬럼은 필터로서 실효성이 낮아 제외한다.
  if (ID_COL_RE.test(col)) return null;
  // 상위 값이 있으면 빠른 선택 칩으로 제공 (부분검색과 병행)
  const topValues = freq
    ? Object.entries(freq)
        .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
        .map(([v]) => v)
        .filter((v) => v != null && String(v).length)
        .slice(0, 12)
    : [];
  return { col, control: "contains", sourceIndex, uniqueCount, topValues };
}
function buildFields(stats) {
  const fields = [];
  (stats || []).forEach((s, idx) => {
    const col = getColumnName(s);
    const cs = getColumnStats(s);
    const f = classifyField(col, cs, idx);
    if (f) fields.push(f);
  });
  fields.sort((a, b) => {
    const ai = DEMOGRAPHIC_PRIORITY.indexOf(a.col), bi = DEMOGRAPHIC_PRIORITY.indexOf(b.col);
    const ap = ai < 0 ? 999 : ai, bp = bi < 0 ? 999 : bi;
    if (ap !== bp) return ap - bp;
    return a.sourceIndex - b.sourceIndex;
  });
  return fields;
}
async function loadMeta(dataset, onWait) {
  const { config, split } = await resolveConfigSplit(dataset);
  const url = `${API}/statistics?dataset=${encodeURIComponent(dataset)}` +
    `&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}`;
  const data = await fetchJson(url, { onWait });
  const fields = buildFields(data.statistics || []);
  return { config, split, total: data.num_examples ?? data.num_rows ?? null, fields };
}

// ---- 국가 선택 -------------------------------------------------------
function resetStateForCountry() {
  state.category = {};
  state.contains = {};
  state.ranges = {};
  state.lastRows = [];
  state.cancelRequested = false;
}
function applyCountryDefaults(country) {
  const maxScan = $("#maxScan");
  const mode = $("#mode");
  if (maxScan && !state.userScanTouched) maxScan.value = String(country.scanDefault || 30000);
  if (mode) mode.value = country.defaultMode || "random";
}
async function selectCountry(dataset) {
  const c = COUNTRIES.find((x) => x.dataset === dataset) || COUNTRIES[0];
  state.dataset = dataset;
  resetStateForCountry();
  applyCountryDefaults(c);
  $("#previewCard").hidden = true;
  $("#downloadBtn").disabled = true;
  setProgress("");
  $("#countryMeta").textContent = `${c.name} · ${c.size}`;
  const profile = $("#countryProfile");
  if (profile) profile.textContent = `수집 환경: ${c.env}`;
  $("#filters").innerHTML = "";
  setBanner(`${c.name} 데이터에 연결하는 중…`, "");
  try {
    const meta = await loadMeta(dataset, ({ warming, sec }) => {
      setBanner(warming
        ? `${c.name} 데이터 색인을 준비하는 중입니다… 처음 접속 시 최대 1~2분 걸릴 수 있어요 (경과 ${sec}초)`
        : `${c.name} 데이터에 연결하는 중… (경과 ${sec}초)`, "");
    });
    state.config = meta.config;
    state.split = meta.split;
    state.total = meta.total;
    state.fields = meta.fields;
    renderFilters(meta.fields);
    const tot = meta.total != null ? meta.total.toLocaleString() : "다수";
    setBanner(`${c.name} 준비 완료 — 실제 소스 통계에서 ${meta.fields.length}개 검색 항목을 구성했습니다.`, "ok");
    $("#countryMeta").textContent = `${c.name} · ${c.size} · 소스 ${tot}명 · config=${meta.config}, split=${meta.split}`;
  } catch (e) {
    console.warn(e);
    state.config = "default";
    state.split = "train";
    state.fields = [];
    renderFilters([]);
    setBanner(`${c.name}의 특성 목록을 불러오지 못했습니다. 조건 없이 수집하거나 잠시 후 다시 시도하세요. (${e.message || e})`, "error");
  }
}

// ---- 필터 UI ---------------------------------------------------------
function renderFilters(fields) {
  const root = $("#filters");
  root.innerHTML = "";
  if (!fields.length) {
    root.appendChild(el("p", { class: "fine" }, "표시할 특성이 없습니다. 아래에서 바로 수집하면 소스 앞부분 또는 무작위 구간에서 인원을 가져옵니다."));
    return;
  }
  for (const f of fields) {
    const wrap = el("div", { class: "field" });
    const title = `${fieldLabel(f.col)} · 원문 컬럼: ${f.col}` + (f.uniqueCount != null ? ` · 고유값 ${f.uniqueCount.toLocaleString()}개` : "");
    wrap.appendChild(el("label", { class: "title", title }, fieldLabel(f.col)));

    if (f.control === "range") {
      wrap.appendChild(buildRange(f));
      wrap.appendChild(el("div", { class: "hint" }, `숫자 범위 · 원문 컬럼 ${f.col}`));
    } else if (f.control === "category") {
      wrap.appendChild(buildMultiSelect(f.col, f.options));
      wrap.appendChild(el("div", { class: "hint" }, "실제 소스 value_counts 기반 · 화면은 한국어 우선, 수집은 원문값 적용"));
    } else {
      wrap.appendChild(buildContains(f.col, containsPlaceholder(f.col), f.topValues));
      const hint = (f.topValues && f.topValues.length)
        ? "원문 포함 검색 · 자주 나오는 값은 아래에서 바로 선택"
        : "원문 포함 검색 · 서버 지원 시 ILIKE, 아니면 브라우저 후처리";
      wrap.appendChild(el("div", { class: "hint" }, hint));
    }
    root.appendChild(wrap);
  }
}
function buildRange(f) {
  const b = f.bounds || { min: 0, max: 120 };
  state.ranges[f.col] = state.ranges[f.col] || { any: true, min: b.min, max: b.max, bounds: b };
  const min = el("input", { type: "number", value: String(state.ranges[f.col].min), min: String(b.min), max: String(b.max), step: "1" });
  const max = el("input", { type: "number", value: String(state.ranges[f.col].max), min: String(b.min), max: String(b.max), step: "1" });
  min.oninput = () => { state.ranges[f.col].min = min.value; };
  max.oninput = () => { state.ranges[f.col].max = max.value; };
  const row = el("div", { class: "age-row" }, [min, el("span", {}, "~"), max]);

  const anyCb = el("input", { type: "checkbox" });
  anyCb.checked = state.ranges[f.col].any;
  const applyAny = () => {
    state.ranges[f.col].any = anyCb.checked;
    min.disabled = max.disabled = anyCb.checked;
    row.classList.toggle("disabled", anyCb.checked);
  };
  anyCb.onchange = applyAny;
  const anyRow = el("label", { class: "opt any" }, [anyCb, document.createTextNode(ANY_LABEL)]);
  const box = el("div", { class: "rangebox" }, [anyRow, el("div", { class: "rangebody" }, row)]);
  applyAny();
  return box;
}
function containsPlaceholder(col) {
  const c = currentCountry();
  if (LOCATION_COL_RE.test(col)) {
    if (c.name === "한국") return "예: 서울 / 강남 / 경기";
    if (c.name === "미국") return "예: New York / California / 10001";
    if (c.name === "일본") return "예: 東京 / Osaka / Kyoto";
    if (c.name === "프랑스") return "예: Paris / Lyon / Rhône";
    if (c.name === "브라질") return "예: São Paulo / Rio de Janeiro";
    if (c.name === "베트남") return "예: Hà Nội / Ho Chi Minh";
    return "현지 원문 지역명 입력";
  }
  if (/occupation|job|industry|employment/i.test(col)) {
    if (c.name === "한국") return "예: 교사 / 의사 / 개발";
    if (c.name === "프랑스") return "예: enseignant / ingénieur / designer";
    if (c.name === "브라질") return "예: professor / engenheiro / designer";
    if (c.name === "일본") return "예: 教師 / エンジニア / デザイナー";
    if (c.name === "베트남") return "예: giáo viên / kỹ sư / nhà thiết kế";
    return "예: teacher / engineer / designer";
  }
  return c.name === "한국" ? "일부 단어 입력" : "영어/현지어 원문 일부 입력";
}
function buildContains(col, placeholder, topValues) {
  const inp = el("input", { type: "text", placeholder, title: `원문 컬럼 ${col}에 포함된 단어를 검색합니다.` });
  inp.value = state.contains[col] || "";
  inp.oninput = () => { state.contains[col] = inp.value; };
  const wrap = el("div", {}, [inp]);
  if (topValues && topValues.length) {
    const chips = el("div", { class: "chips" });
    topValues.forEach((v) => {
      const label = displayValue(col, v);
      const chip = el("button", { class: "chip", type: "button", title: `원문값: ${v}` }, label);
      chip.onclick = () => {
        inp.value = v;
        state.contains[col] = v;
        chips.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
        chip.classList.add("on");
      };
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);
  }
  return wrap;
}
function buildMultiSelect(col, options) {
  state.category[col] = state.category[col] || [];
  const box = el("div", { class: "multi" });
  const list = el("div", { class: "list" });

  const anyCb = el("input", { type: "checkbox" });
  const anyRow = el("label", { class: "opt any" }, [anyCb, document.createTextNode(ANY_LABEL)]);
  const optionCbs = [];
  const isAny = () => state.category[col].length === 0;
  const syncAny = () => { anyCb.checked = isAny(); };
  anyCb.onchange = () => {
    if (anyCb.checked) {
      state.category[col] = [];
      optionCbs.forEach((c) => (c.checked = false));
    } else anyCb.checked = true;
  };

  const displayCounts = new Map();
  options.forEach((opt) => {
    const d = displayValue(col, opt);
    displayCounts.set(d, (displayCounts.get(d) || 0) + 1);
  });

  options.forEach((opt) => {
    const cb = el("input", { type: "checkbox" });
    cb.checked = state.category[col].includes(opt);
    cb.onchange = () => {
      const set = new Set(state.category[col]);
      cb.checked ? set.add(opt) : set.delete(opt);
      state.category[col] = [...set];
      syncAny();
    };
    optionCbs.push(cb);
    const translated = displayValue(col, opt);
    const text = displayCounts.get(translated) > 1 && translated !== String(opt) ? `${translated} (${opt})` : translated;
    list.appendChild(el("label", { class: "opt", title: `원문값: ${opt}` }, [cb, document.createTextNode(text)]));
  });

  syncAny();
  box.appendChild(anyRow);
  box.appendChild(list);
  return box;
}

// ---- 수집 실행 -------------------------------------------------------
function setCollectingUI(on) {
  state.isCollecting = on;
  $("#runBtn").disabled = on;
  $("#cancelBtn").disabled = !on;
  $("#downloadBtn").disabled = on || !state.lastRows.length;
  $("#resetBtn").disabled = on;
  $("#resetBottomBtn").disabled = on;
  $("#country").disabled = on;
}
function mapRows(rows) { return (rows || []).map((r) => (r && r.row ? r.row : r)); }
function getMaxN() { return Math.min(Math.max(parseInt($("#maxN").value, 10) || HARD_CAP, 1), HARD_CAP); }
function getMaxScan(maxN) {
  const raw = parseInt($("#maxScan").value, 10);
  return Math.min(Math.max(raw || currentCountry().scanDefault || 30000, maxN, SCAN_MIN), SCAN_MAX);
}
function scanConcurrency() {
  return (($("#token")?.value || "").trim()) ? CONC_TOKEN : CONC_ANON;
}
function randomPageOffset(total) {
  if (!total || total <= PAGE) return 0;
  const maxPage = Math.max(0, Math.floor((total - PAGE) / PAGE));
  return Math.floor(Math.random() * (maxPage + 1)) * PAGE;
}
function nextOffsetFactory(total, mode) {
  let offset = mode === "random" && total ? randomPageOffset(total) : 0;
  const visited = new Set();
  return () => {
    if (!total || mode !== "random") {
      const cur = offset;
      offset += PAGE;
      return cur;
    }
    if (visited.size >= Math.ceil(total / PAGE)) return null;
    let cur = randomPageOffset(total);
    let guard = 0;
    while (visited.has(cur) && guard < 30) { cur = randomPageOffset(total); guard++; }
    while (visited.has(cur)) {
      cur += PAGE;
      if (cur >= total) cur = 0;
    }
    visited.add(cur);
    return cur;
  };
}
async function collect() {
  // 부분검색이 있으면 먼저 서버 ILIKE 지원 여부를 감지(데이터셋당 1회)
  const rawContains = getClientContainsFilters();
  if (rawContains.length && !ILIKE_SUPPORT.has(state.dataset)) {
    setProgress("서버 부분검색(ILIKE) 지원 여부 확인 중…");
    try { await detectIlikeSupport(rawContains[0].col); } catch (e) { if ((e.message || "").includes("취소")) throw e; }
  }

  const { serverWhere, clientFilters, serverContainsUsed, warnings } = buildQueryPlan();
  const hasClient = clientFilters.length > 0;
  const serverFiltered = serverWhere.length > 0;
  const maxN = getMaxN();
  const maxScan = getMaxScan(maxN);
  const mode = $("#mode").value;
  if (warnings.length) setBanner("주의 — " + warnings.join(" · "), "");

  const onWait = ({ warming, sec }) => {
    setProgress(warming
      ? `데이터 색인을 준비하는 중입니다… 처음 조회 시 최대 1~2분 걸릴 수 있어요 (경과 ${sec}초)`
      : `연결 중… (경과 ${sec}초)`);
  };

  checkCancelled();
  const probe = await fetchJson(buildUrl(serverWhere, 0, 1), { onWait });
  const total = probe.num_rows_total != null ? probe.num_rows_total : null;
  const partial = probe.partial === true;
  const totalTxt = total != null ? total.toLocaleString() : "?";
  const scopeTxt = serverFiltered ? "조건에 맞는" : "전체";
  if (total === 0) { setProgress("조건에 맞는 사람이 없습니다. 조건을 완화해 보세요."); return []; }

  // ---- 클라이언트 부분검색이 없는 경우: 서버 조건만으로 수집 (무작위=페이지 단위로 통일) ----
  if (!hasClient) {
    const getNextOffset = nextOffsetFactory(total, mode);
    const rows = [];
    while (rows.length < maxN) {
      checkCancelled();
      const offset = getNextOffset();
      if (offset == null) break;
      let need = Math.min(PAGE, maxN - rows.length);
      if (total != null) need = Math.min(need, Math.max(0, total - offset));
      if (need <= 0) { if (mode !== "random") break; else continue; }
      const data = await fetchJson(buildUrl(serverWhere, offset, need), { onWait });
      const got = mapRows(data.rows);
      rows.push(...got);
      setProgress(`수집 중… ${rows.length.toLocaleString()} / ${Math.min(maxN, total || maxN).toLocaleString()}명 · ${scopeTxt} ${totalTxt}명`
        + (mode === "random" ? " · 무작위" : "") + (partial ? " · 부분 인덱스" : ""));
      if (got.length === 0) break;
      if (got.length < need && mode !== "random") break;
    }
    const finalRows = rows.slice(0, maxN);
    setProgress(`완료 — ${scopeTxt} ${totalTxt}명 중 ${finalRows.length.toLocaleString()}명 수집`
      + (serverContainsUsed ? " · 서버 부분검색(ILIKE) 사용" : "")
      + (partial ? " · 데이터가 커서 인덱싱된 앞부분 기준입니다." : ""));
    return finalRows;
  }

  // ---- 클라이언트 부분검색이 있는 경우: 서버로 1차 축소 후 '동시성 스캔' + 원문 포함 검사 ----
  const scanLimit = total != null ? Math.min(maxScan, total) : maxScan;
  const getNextOffset = nextOffsetFactory(total, mode);
  const rows = [];
  let scanned = 0;
  const shouldStop = () => state.cancelRequested || rows.length >= maxN || scanned >= scanLimit;

  async function scanWorker() {
    while (!shouldStop()) {
      checkCancelled();
      const offset = getNextOffset();
      if (offset == null) break;
      let need = Math.min(PAGE, scanLimit - scanned);
      if (total != null) need = Math.min(need, Math.max(0, total - offset));
      if (need <= 0) { if (mode !== "random") break; else continue; }
      scanned += need;                         // 예약(동시성 초과 스캔 방지)
      const data = await fetchJson(buildUrl(serverWhere, offset, need), { onWait });
      const got = mapRows(data.rows);
      scanned += got.length - need;            // 실제값으로 보정
      for (const r of got) {
        if (rowMatchesContains(r, clientFilters)) { rows.push(r); if (rows.length >= maxN) break; }
      }
      setProgress(`검색 중… ${scanned.toLocaleString()}행 확인 · 일치 ${rows.length.toLocaleString()} / ${maxN.toLocaleString()}명`
        + (serverFiltered ? ` · 1차 ${scopeTxt} ${totalTxt}명` : "")
        + (mode === "random" ? " · 무작위" : "") + (partial ? " · 부분 인덱스" : ""));
      if (got.length === 0) break;
    }
  }
  await Promise.all(Array.from({ length: scanConcurrency() }, scanWorker));

  const finalRows = rows.slice(0, maxN);
  if (!finalRows.length) {
    setProgress(`완료 — ${scanned.toLocaleString()}행을 확인했지만 조건에 맞는 사람이 없습니다. 해외 데이터는 현지 원문 표기로 입력하거나 최대 검색 행 수를 늘려 보세요.`);
    return [];
  }
  setProgress(`완료 — ${scanned.toLocaleString()}행을 확인해 ${finalRows.length.toLocaleString()}명 수집`
    + (finalRows.length < maxN ? " · 더 필요하면 최대 검색 행 수를 늘려 다시 실행하세요." : "")
    + (partial ? " · 데이터가 커서 인덱싱된 앞부분 기준입니다." : ""));
  return finalRows;
}
// ---- 미리보기 / 엑셀 -------------------------------------------------
function orderedColumns(sample) {
  const keys = Object.keys(sample);
  const first = PREFERRED_EXPORT_ORDER.filter((c) => keys.includes(c));
  const rest = keys.filter((c) => !first.includes(c));
  return [...first, ...rest];
}
function renderPreview(rows) {
  const card = $("#previewCard");
  const table = $("#previewTable");
  table.innerHTML = "";
  if (!rows.length) { card.hidden = true; return; }
  const cols = orderedColumns(rows[0]);
  table.appendChild(el("thead", {}, el("tr", {}, cols.map((c) => el("th", { title: c }, fieldLabel(c))))));
  const tbody = el("tbody");
  rows.slice(0, 20).forEach((r) => {
    tbody.appendChild(el("tr", {}, cols.map((c) => {
      const v = r[c] == null ? "" : String(r[c]);
      return el("td", { title: v }, v.length > 120 ? v.slice(0, 120) + "…" : v);
    })));
  });
  table.appendChild(tbody);
  $("#previewCount").textContent = `(상위 ${Math.min(20, rows.length)}행 · 총 ${rows.length.toLocaleString()}행)`;
  card.hidden = false;
}
function saveExcel(rows) {
  if (!rows.length) return;
  const cols = orderedColumns(rows[0]);
  const aoa = [cols.map((c) => fieldLabel(c))];
  rows.forEach((r) => aoa.push(cols.map((c) => (r[c] == null ? "" : r[c]))));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map((c) => ({ wch: Math.min(fieldLabel(c).length + 10, 44) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "personas");
  const country = currentCountry().name || "personas";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  XLSX.writeFile(wb, `${country}_${rows.length}_${stamp}.xlsx`);
}

// ---- 리셋 / 취소 -----------------------------------------------------
function resetAllFilters() {
  state.category = {};
  state.contains = {};
  state.ranges = {};
  state.lastRows = [];
  $("#previewCard").hidden = true;
  setProgress("");
  $("#downloadBtn").disabled = true;
  renderFilters(state.fields);
}
function cancelCollect() {
  if (!state.isCollecting) return;
  state.cancelRequested = true;
  setProgress("수집 취소 중… 현재 요청을 중단하고 있습니다.");
  if (state.activeController) state.activeController.abort();
}

// ---- 초기화 ----------------------------------------------------------
function initCountrySelect() {
  const sel = $("#country");
  COUNTRIES.forEach((c) => sel.appendChild(el("option", { value: c.dataset }, `${c.name} — ${c.size}`)));
  sel.value = state.dataset;
  sel.onchange = () => selectCountry(sel.value);
}
async function init() {
  initCountrySelect();
  const maxScan = $("#maxScan");
  if (maxScan) maxScan.oninput = () => { state.userScanTouched = true; };

  $("#runBtn").onclick = async () => {
    state.cancelRequested = false;
    state.activeController = new AbortController();
    state.lastRows = [];
    setCollectingUI(true);
    setProgress("총원 확인 중…");
    try {
      const rows = await collect();
      state.lastRows = rows;
      renderPreview(rows);
      $("#downloadBtn").disabled = rows.length === 0;
      if (rows.length) setBanner("수집이 완료되었습니다. 미리보기를 확인한 뒤 엑셀로 저장할 수 있습니다.", "ok");
    } catch (e) {
      console.error(e);
      if ((e.message || "").includes("취소")) {
        setProgress("수집이 취소되었습니다.");
        setBanner("수집을 취소했습니다. 조건을 바꾼 뒤 다시 실행할 수 있습니다.", "");
      } else {
        setProgress("");
        setBanner("데이터를 가져오지 못했습니다: " + (e.message || e) +
          "  네트워크를 확인하거나, 조건을 단순화하거나, 고급 설정에서 HF 토큰을 입력해 보세요.", "error");
      }
    } finally {
      state.activeController = null;
      state.cancelRequested = false;
      setCollectingUI(false);
    }
  };

  $("#cancelBtn").onclick = cancelCollect;
  $("#downloadBtn").onclick = () => saveExcel(state.lastRows);
  $("#resetBtn").onclick = resetAllFilters;
  $("#resetBottomBtn").onclick = resetAllFilters;

  await selectCountry(state.dataset);
}
document.addEventListener("DOMContentLoaded", init);
