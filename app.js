/* =====================================================================
 * Nemotron-Personas Korea 2단계 추출기 (브라우저 전용)
 * - 한국 데이터셋만 사용한다.
 * - 1차: 정확 조건만 서버 /filter로 적용해 최대 5,000명 후보 수집.
 * - 2차: 엑셀 업로드 없이 1차 후보군(state.stage1Rows) 안에서 정밀 필터링.
 * ===================================================================== */
"use strict";

// ---- 공통 설정 -------------------------------------------------------
const API = "https://datasets-server.huggingface.co";
const DATASET = "nvidia/Nemotron-Personas-Korea";
const DATASET_LABEL = "한국";
const PAGE = 100;
const HARD_CAP = 5000;
const SCAN_MIN = 1000;
const SCAN_MAX = 500000;
const CAT_MAX = 160;
const CAT_OR_MAX = 60;
const WHERE_MAX_LEN = 1900;
const CONC_ANON = 4;
const CONC_TOKEN = 6;
const ANY_LABEL = "상관 없음";

const FALLBACK_COLUMNS = [
  "uuid", "sex", "age", "marital_status", "military_status", "family_type", "housing_type",
  "education_level", "bachelors_field", "occupation", "district", "province", "country",
  "professional_persona", "sports_persona", "arts_persona", "travel_persona", "culinary_persona",
  "family_persona", "persona", "cultural_background", "skills_and_expertise",
  "hobbies_and_interests", "career_goals_and_ambitions"
];

const DEFAULT_TEXT_COLUMNS = [
  "occupation", "professional_persona", "persona", "cultural_background", "skills_and_expertise",
  "hobbies_and_interests", "career_goals_and_ambitions", "family_persona", "arts_persona",
  "travel_persona", "culinary_persona", "bachelors_field", "education_level", "district", "province"
];

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
  district: "구/군", sigungu: "시군구", sido: "시도", city: "도시",
  zipcode: "우편번호", postal_code: "우편번호",
  persona: "페르소나 요약", professional_persona: "직업 페르소나",
  sports_persona: "스포츠 페르소나", arts_persona: "예술 페르소나",
  travel_persona: "여행 페르소나", culinary_persona: "요리 페르소나",
  family_persona: "가족 페르소나", cultural_background: "문화적 배경",
  skills_and_expertise: "기술 및 전문성", hobbies_and_interests: "취미 및 관심사",
  career_goals_and_ambitions: "경력 목표", personality_traits: "성격 특성",
};

const DEMOGRAPHIC_PRIORITY = [
  "sex", "gender", "age", "marital_status", "military_status", "education_level", "education",
  "bachelors_field", "field_of_study", "occupation", "job", "employment_status",
  "family_type", "household_type", "housing_type", "income_level", "country", "province", "district", "city",
];

const PREFERRED_EXPORT_ORDER = [
  "uuid", "id", "person_id", "sex", "gender", "age", "marital_status", "military_status",
  "family_type", "household_type", "housing_type", "education_level", "education", "bachelors_field",
  "field_of_study", "occupation", "job", "employment_status", "industry",
  "country", "province", "district", "city",
  "persona", "professional_persona", "family_persona", "cultural_background",
  "skills_and_expertise", "hobbies_and_interests", "career_goals_and_ambitions",
  "sports_persona", "arts_persona", "travel_persona", "culinary_persona"
];

const INTERNAL_COL_RE = /^(row_idx|__index_level_0__|index)$/i;
const ID_COL_RE = /^(uuid|id|person_id)$/i;
const LOCATION_COL_RE = /(country|region|province|state|district|city|municipality|commune|county|locality|ward|neighborhood|zipcode|postal|sido|sigungu|department)/i;
const TEXT_FOCUS_RE = /(occupation|job|industry|persona|background|skills|expertise|hobbies|interests|goals|ambitions|career|field|education|district|province|family|culture|arts|travel|culinary|sports)/i;
const NUMERIC_TYPE_RE = /int|float|double|decimal|numeric|number/i;
const STRINGISH_TYPE_RE = /string|label|bool|list|audio|image|class/i;
const LIST_DUP_RE = /_list$/i;

// ---- 상태 ------------------------------------------------------------
const state = {
  dataset: DATASET,
  config: "default",
  split: "train",
  total: null,
  statistics: [],
  exactFields: [],
  allColumns: [...FALLBACK_COLUMNS],
  category: {},
  ranges: {},
  stage1Rows: [],
  finalRows: [],
  previewRows: [],
  previewLabel: "",
  activeController: null,
  cancelRequested: false,
  isCollecting: false,
};

// ---- DOM 헬퍼 --------------------------------------------------------
const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "title") n.title = v;
    else if (k === "checked") n.checked = Boolean(v);
    else if (k === "disabled") n.disabled = Boolean(v);
    else n.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return n;
}
function fieldLabel(col) { return LABELS[col] || humanize(col); }
function humanize(col) { return String(col || "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()); }
function setBanner(msg, type = "") {
  const b = $("#banner");
  b.textContent = msg;
  b.className = "banner" + (type ? " " + type : "");
}
function setProgress(msg) { $("#progress").textContent = msg || ""; }
function setStage2Progress(msg) { $("#stage2Progress").textContent = msg || ""; }
function formatN(v) { return Number(v || 0).toLocaleString(); }

// ---- 값 표시 / 텍스트 정규화 ---------------------------------------
const VALUE_TRANSLATIONS = new Map(Object.entries({
  "male": "남성", "m": "남성", "man": "남성",
  "female": "여성", "f": "여성", "woman": "여성",
  "single": "미혼", "unmarried": "미혼", "married": "기혼", "divorced": "이혼", "widowed": "사별", "separated": "별거",
  "apartment": "아파트", "house": "단독주택", "studio": "원룸", "owned": "자가", "rented": "임대",
  "completed": "완료", "exempt": "면제", "not applicable": "해당 없음",
  "yes": "예", "no": "아니오", "true": "예", "false": "아니오", "none": "없음", "unknown": "알 수 없음",
}));
function normalizeKey(v) { return String(v ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "); }
function displayValue(col, raw) {
  const s = String(raw ?? "");
  if (!s) return "빈 값";
  if (LOCATION_COL_RE.test(col)) return s;
  return VALUE_TRANSLATIONS.get(normalizeKey(s)) || s;
}
function normText(v) {
  return String(v ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[_\-/,.;:()\[\]{}"'“”‘’·]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function cellText(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(cellText).join(" ");
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}
function rowText(row, cols) {
  return (cols && cols.length ? cols : state.allColumns).map((c) => cellText(row[c])).join(" \n ");
}
function parseKeywords(text) {
  return String(text || "")
    .split(/[\n,;|/]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.findIndex((x) => normText(x) === normText(v)) === i);
}
function keywordCount(row, cols, keywords) {
  if (!keywords.length) return 0;
  const value = normText(rowText(row, cols));
  if (!value) return 0;
  let count = 0;
  for (const kw of keywords) {
    const q = normText(kw);
    if (!q) continue;
    if (value.includes(q)) {
      count++;
      continue;
    }
    // 공백이 있는 구문은 토큰 전체 포함도 허용: "사용자 조사" → 사용자 + 조사
    const tokens = q.split(" ").filter(Boolean);
    if (tokens.length > 1 && tokens.every((t) => value.includes(t))) count++;
  }
  return count;
}
function matchesKeywords(row, cols, keywords, mode = "any", minCount = 1) {
  if (!keywords.length) return true;
  const count = keywordCount(row, cols, keywords);
  if (mode === "all") return count >= keywords.length;
  if (mode === "min") return count >= Math.max(1, Number(minCount) || 1);
  return count >= 1;
}
function hasAnyKeyword(row, cols, keywords) {
  return keywords.length > 0 && keywordCount(row, cols, keywords) >= 1;
}

// ---- SQL / API -------------------------------------------------------
const sqlStr = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const q = (col) => '"' + String(col).replace(/"/g, '""') + '"';
function authHeaders() {
  const t = ($("#token")?.value || "").trim();
  return t ? { Authorization: "Bearer " + t } : {};
}
function checkCancelled() {
  if (state.cancelRequested) throw new Error("수집이 취소되었습니다.");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const { maxWaitMs = 120000, onWait = null } = opts;
  const start = Date.now();
  let attempt = 0;
  while (true) {
    checkCancelled();
    attempt++;
    let status = 0, body = "", netErr = null;
    try {
      const res = await fetch(url, { headers: authHeaders(), mode: "cors", signal: state.activeController?.signal });
      status = res.status;
      if (res.ok) return await res.json();
      body = await res.text().catch(() => "");
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("수집이 취소되었습니다.");
      netErr = e;
    }
    const kind = netErr ? "retry" : classifyHttp(status, body);
    if (kind === "notfound") throw new Error("데이터셋을 찾을 수 없습니다. 저장소 이름을 확인하세요.");
    if (kind === "auth") throw new Error("접근 권한이 필요합니다. 고급 설정에서 Hugging Face 토큰을 입력해 보세요.");
    if (kind === "fatal") throw new Error(`HTTP ${status} ${(body || "").slice(0, 180)}`);

    const elapsed = Date.now() - start;
    if (elapsed > maxWaitMs) {
      if (kind === "warming") throw new Error("데이터 색인 준비가 예상보다 오래 걸립니다. 잠시 후 다시 시도해 주세요.");
      throw new Error(netErr ? ("네트워크 오류: " + netErr.message) : `HTTP ${status} ${(body || "").slice(0, 180)}`);
    }
    if (onWait) onWait({ warming: kind === "warming", sec: Math.round(elapsed / 1000), attempt });
    await sleep(kind === "warming" ? Math.min(2500 + attempt * 1000, 6500) : Math.min(700 * attempt, 4500));
  }
}
async function resolveConfigSplit() {
  try {
    const s = await fetchJson(`${API}/splits?dataset=${encodeURIComponent(DATASET)}`, { maxWaitMs: 30000 });
    const arr = s.splits || [];
    if (arr.length) {
      const t = arr.find((x) => x.split === "train") || arr[0];
      return { config: t.config, split: t.split };
    }
  } catch (e) { /* 기본값 사용 */ }
  return { config: "default", split: "train" };
}
function buildUrl(where, offset, length) {
  const common = `dataset=${encodeURIComponent(DATASET)}&config=${encodeURIComponent(state.config)}` +
    `&split=${encodeURIComponent(state.split)}&offset=${offset}&length=${length}`;
  return where && where.length ? `${API}/filter?${common}&where=${encodeURIComponent(where)}` : `${API}/rows?${common}`;
}
function mapRows(rows) { return (rows || []).map((r) => (r && r.row ? r.row : r)); }

// ---- 메타 / 필드 구성 -----------------------------------------------
function getColumnName(s) { return s.column_name || s.column || s.name || s.feature || ""; }
function getColumnStats(s) { return s.column_statistics || s.statistics || s.stats || {}; }
function getColumnType(s) {
  const cs = getColumnStats(s);
  return String(s.column_type || s.type || s.dtype || cs.dtype || cs.type || "").toLowerCase();
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
function getFrequencies(cs) { return normalizeFreq(cs.frequencies || cs.value_counts || cs.top_values); }
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
function isNumericColumn(colType, col, minMax) {
  if (!minMax) return false;
  if (/zip|postal|code/i.test(col)) return false;
  const t = String(colType || "");
  if (NUMERIC_TYPE_RE.test(t)) return true;
  if (STRINGISH_TYPE_RE.test(t)) return false;
  return col === "age" || /(^|_)(age|year|income|salary|amount|score|count|number)(_|$)/i.test(col);
}
function classifyExactField(stat, idx) {
  const col = getColumnName(stat);
  if (!col || INTERNAL_COL_RE.test(col) || ID_COL_RE.test(col) || LIST_DUP_RE.test(col)) return null;
  const cs = getColumnStats(stat);
  const colType = getColumnType(stat);
  const freq = getFrequencies(cs);
  const uniqueCount = getUniqueCount(cs, freq);
  const minMax = getMinMax(cs);
  const nullCount = Number(cs.null_count ?? cs.n_missing ?? 0);
  const count = Number(cs.count ?? cs.n ?? cs.total ?? 0);
  if (uniqueCount === 0 || (count > 0 && nullCount >= count)) return null;

  if (isNumericColumn(colType, col, minMax)) {
    return { col, control: "range", bounds: minMax, sourceIndex: idx, uniqueCount };
  }
  if (freq && uniqueCount != null && uniqueCount >= 1 && uniqueCount <= CAT_MAX) {
    const options = Object.keys(freq)
      .filter((v) => v != null && String(v).length)
      .sort((a, b) => String(a).localeCompare(String(b), "ko", { numeric: true, sensitivity: "base" }));
    return { col, control: "category", options, sourceIndex: idx, uniqueCount };
  }
  return null;
}
function buildExactFields(stats) {
  const fields = [];
  (stats || []).forEach((s, idx) => {
    const f = classifyExactField(s, idx);
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
function buildAllColumns(stats) {
  const cols = (stats || [])
    .map(getColumnName)
    .filter((c) => c && !INTERNAL_COL_RE.test(c) && !LIST_DUP_RE.test(c));
  const ordered = [...PREFERRED_EXPORT_ORDER.filter((c) => cols.includes(c)), ...cols.filter((c) => !PREFERRED_EXPORT_ORDER.includes(c))];
  return ordered.length ? ordered : [...FALLBACK_COLUMNS];
}
function defaultKeywordCols() {
  const cols = state.allColumns.filter((c) => DEFAULT_TEXT_COLUMNS.includes(c) || TEXT_FOCUS_RE.test(c));
  return cols.length ? cols : state.allColumns.filter((c) => !ID_COL_RE.test(c));
}
async function loadMeta() {
  const { config, split } = await resolveConfigSplit();
  state.config = config;
  state.split = split;
  $("#configSplit").textContent = `${config} / ${split}`;

  const url = `${API}/statistics?dataset=${encodeURIComponent(DATASET)}&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}`;
  const data = await fetchJson(url, {
    onWait: ({ warming, sec }) => {
      setBanner(warming ? `한국 데이터 색인을 준비하는 중입니다… 처음 접속 시 최대 1~2분 걸릴 수 있습니다 (경과 ${sec}초)` : `한국 데이터에 연결하는 중… (경과 ${sec}초)`, "");
    }
  });
  state.total = data.num_examples ?? data.num_rows ?? null;
  state.statistics = data.statistics || [];
  state.exactFields = buildExactFields(state.statistics);
  state.allColumns = buildAllColumns(state.statistics);

  $("#sourceTotal").textContent = state.total != null ? `${formatN(state.total)} 레코드 / 7개 페르소나 필드` : "다수";
  setBanner(`한국 데이터 준비 완료 — 정확 조건 ${state.exactFields.length}개, 검색 대상 컬럼 ${state.allColumns.length}개를 구성했습니다.`, "ok");
}

// ---- 정확 조건 UI ----------------------------------------------------
function renderExactFilters(fields) {
  const root = $("#filters");
  root.innerHTML = "";
  if (!fields.length) {
    root.appendChild(el("p", { class: "fine" }, "표시할 정확 조건이 없습니다. 조건 없이 1차 후보를 수집할 수 있습니다."));
    return;
  }
  for (const f of fields) {
    const wrap = el("div", { class: "field" });
    const title = `${fieldLabel(f.col)} · 원문 컬럼: ${f.col}` + (f.uniqueCount != null ? ` · 고유값 ${formatN(f.uniqueCount)}개` : "");
    wrap.appendChild(el("label", { class: "title", title }, fieldLabel(f.col)));
    if (f.control === "range") {
      wrap.appendChild(buildRange(f));
      wrap.appendChild(el("div", { class: "hint" }, `숫자 범위 · 원문 컬럼 ${f.col}`));
    } else {
      wrap.appendChild(buildMultiSelect(f.col, f.options));
      wrap.appendChild(el("div", { class: "hint" }, "실제 소스 value_counts 기반 · 원문값으로 수집"));
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
  const anyCb = el("input", { type: "checkbox", checked: state.ranges[f.col].any });
  const applyAny = () => {
    state.ranges[f.col].any = anyCb.checked;
    min.disabled = max.disabled = anyCb.checked;
    row.classList.toggle("disabled", anyCb.checked);
  };
  anyCb.onchange = applyAny;
  const box = el("div", { class: "rangebox" }, [el("label", { class: "opt any" }, [anyCb, document.createTextNode(ANY_LABEL)]), el("div", { class: "rangebody" }, row)]);
  applyAny();
  return box;
}
function buildMultiSelect(col, options) {
  state.category[col] = state.category[col] || [];
  const box = el("div", { class: "multi" });
  const list = el("div", { class: "list" });
  const anyCb = el("input", { type: "checkbox" });
  const optionCbs = [];
  const syncAny = () => { anyCb.checked = state.category[col].length === 0; };
  anyCb.onchange = () => {
    if (anyCb.checked) {
      state.category[col] = [];
      optionCbs.forEach((c) => { c.checked = false; });
    } else anyCb.checked = true;
  };

  const displayCounts = new Map();
  options.forEach((opt) => {
    const d = displayValue(col, opt);
    displayCounts.set(d, (displayCounts.get(d) || 0) + 1);
  });

  options.forEach((opt) => {
    const cb = el("input", { type: "checkbox", checked: state.category[col].includes(opt) });
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
  box.appendChild(el("label", { class: "opt any" }, [anyCb, document.createTextNode(ANY_LABEL)]));
  box.appendChild(list);
  return box;
}
function resetExactFilters() {
  state.category = {};
  state.ranges = {};
  renderExactFilters(state.exactFields);
}

// ---- 컬럼 선택 UI ----------------------------------------------------
function renderColumnChecks(containerId, selectedCols = defaultKeywordCols()) {
  const root = $(containerId);
  root.innerHTML = "";
  const selected = new Set(selectedCols);
  state.allColumns.forEach((col) => {
    const cb = el("input", { type: "checkbox", value: col, checked: selected.has(col) });
    const label = el("label", { class: "col-check", title: col }, [
      cb,
      document.createTextNode(fieldLabel(col)),
      el("small", {}, col)
    ]);
    root.appendChild(label);
  });
}
function getSelectedColumns(containerId) {
  const checked = Array.from(document.querySelectorAll(`${containerId} input[type="checkbox"]:checked`)).map((n) => n.value);
  return checked.length ? checked : defaultKeywordCols();
}
function setColumnSelection(containerId, mode) {
  const defaults = new Set(mode === "all" ? state.allColumns : defaultKeywordCols());
  document.querySelectorAll(`${containerId} input[type="checkbox"]`).forEach((n) => { n.checked = defaults.has(n.value); });
}

// ---- where 구성 ------------------------------------------------------
function categoryPredicates() {
  const preds = [], warnings = [];
  for (const [col, vals] of Object.entries(state.category)) {
    const arr = (vals || []).filter((x) => x !== "" && x != null);
    if (!arr.length) continue;
    if (arr.length > CAT_OR_MAX) { warnings.push(fieldLabel(col)); continue; }
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
function buildServerWhere() {
  const warnings = [];
  const { preds: catPreds, warnings: catWarn } = categoryPredicates();
  if (catWarn.length) warnings.push(`선택 항목이 너무 많아 제외한 조건: ${catWarn.join(", ")}`);
  const rangeP = rangePredicates();
  let catSql = catPreds.map((p) => p.sql);
  let where = [...catSql, ...rangeP].filter(Boolean).join(" AND ");

  if (encodeURIComponent(where).length > WHERE_MAX_LEN && catPreds.length) {
    const sorted = [...catPreds].sort((a, b) => b.size - a.size);
    const dropped = [];
    while (encodeURIComponent(where).length > WHERE_MAX_LEN && sorted.length) {
      dropped.push(sorted.shift().col);
      catSql = sorted.map((p) => p.sql);
      where = [...catSql, ...rangeP].filter(Boolean).join(" AND ");
    }
    if (dropped.length) warnings.push(`조건이 너무 길어 제외한 범주: ${dropped.map(fieldLabel).join(", ")}`);
  }
  return { where, warnings };
}

// ---- 수집 로직 -------------------------------------------------------
function getMaxN() { return Math.min(Math.max(parseInt($("#maxN").value, 10) || HARD_CAP, 1), HARD_CAP); }
function scanConcurrency() { return (($("#token")?.value || "").trim()) ? CONC_TOKEN : CONC_ANON; }
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
function setCollectingUI(on) {
  state.isCollecting = on;
  $("#runBtn").disabled = on;
  $("#cancelBtn").disabled = !on;
  $("#resetBtn").disabled = on;
  $("#downloadStage1Btn").disabled = on || !state.stage1Rows.length;
  $("#filterStage2Btn").disabled = on || !state.stage1Rows.length;
}
async function collectStage1() {
  const { where, warnings } = buildServerWhere();
  if (warnings.length) setBanner("주의 — " + warnings.join(" · "), "");

  const maxN = getMaxN();
  const mode = $("#mode").value;

  const onWait = ({ warming, sec }) => {
    setProgress(warming ? `데이터 색인을 준비하는 중입니다… 처음 조회 시 최대 1~2분 걸릴 수 있습니다 (경과 ${sec}초)` : `연결 중… (경과 ${sec}초)`);
  };

  checkCancelled();
  const probe = await fetchJson(buildUrl(where, 0, 1), { onWait });
  const total = probe.num_rows_total != null ? probe.num_rows_total : null;
  const partial = probe.partial === true;
  const totalTxt = total != null ? formatN(total) : "?";
  const scopeTxt = where ? "정확 조건에 맞는" : "전체";
  if (total === 0) {
    setProgress("정확 조건에 맞는 사람이 없습니다. 조건을 완화해 보세요.");
    return [];
  }

  // 1차는 키워드 검색 없이 서버 정확 조건만으로 수집한다.
  const getNextOffset = nextOffsetFactory(total, mode);
  const rows = [];
  while (rows.length < maxN) {
    checkCancelled();
    const offset = getNextOffset();
    if (offset == null) break;
    let need = Math.min(PAGE, maxN - rows.length);
    if (total != null) need = Math.min(need, Math.max(0, total - offset));
    if (need <= 0) break;
    const data = await fetchJson(buildUrl(where, offset, need), { onWait });
    const got = mapRows(data.rows);
    rows.push(...got);
    setProgress(`1차 수집 중… ${formatN(rows.length)} / ${formatN(Math.min(maxN, total || maxN))}명 · ${scopeTxt} ${totalTxt}명` + (mode === "random" ? " · 무작위" : "") + (partial ? " · 부분 인덱스" : ""));
    if (got.length === 0 || (got.length < need && mode !== "random")) break;
  }
  return rows.slice(0, maxN);
}

// ---- 2차 필터링 ------------------------------------------------------
function enableSecondary(on) {
  $("#secondaryBody").classList.toggle("disabled", !on);
  $("#filterStage2Btn").disabled = !on || state.isCollecting;
  $("#resetStage2Btn").disabled = !on;
  $("#downloadFinalBtn").disabled = !on || !state.finalRows.length;
  const notice = $("#secondaryNotice");
  if (on) {
    notice.textContent = `1차 후보 ${formatN(state.stage1Rows.length)}명 안에서 2차 필터링할 수 있습니다.`;
    notice.className = "notice ok";
  } else {
    notice.textContent = "먼저 1차 후보를 수집하면 2차 필터를 사용할 수 있습니다.";
    notice.className = "notice";
  }
}
function applyStage2Filter() {
  if (!state.stage1Rows.length) return;
  const include = parseKeywords($("#stage2Include").value);
  const exclude = parseKeywords($("#stage2Exclude").value);
  const mode = $("#stage2Mode").value;
  const minCount = parseInt($("#stage2Min").value, 10) || 1;
  const cols = getSelectedColumns("#stage2Columns");

  const filtered = state.stage1Rows.filter((row) => {
    const includeOk = matchesKeywords(row, cols, include, mode, minCount);
    const excludeHit = hasAnyKeyword(row, cols, exclude);
    return includeOk && !excludeHit;
  });

  state.finalRows = filtered;
  setStage2Progress(`2차 필터 완료 — 1차 후보 ${formatN(state.stage1Rows.length)}명 중 최종 ${formatN(filtered.length)}명`);
  renderPreview(filtered, "2차 최종 결과");
  updateSummary("2차 최종 결과");
  $("#downloadFinalBtn").disabled = filtered.length === 0;
}
function resetStage2() {
  $("#stage2Include").value = "";
  $("#stage2Exclude").value = "";
  $("#stage2Mode").value = "any";
  $("#stage2Min").value = "2";
  setColumnSelection("#stage2Columns", "text");
  state.finalRows = [...state.stage1Rows];
  setStage2Progress("2차 조건을 초기화했습니다. 현재 최종 결과는 1차 후보 전체입니다.");
  renderPreview(state.finalRows, "1차 후보 전체");
  updateSummary("1차 후보 전체");
  $("#downloadFinalBtn").disabled = state.finalRows.length === 0;
}

// ---- 미리보기 / 엑셀 -------------------------------------------------
function orderedColumns(sample) {
  const keys = Object.keys(sample || {});
  const first = PREFERRED_EXPORT_ORDER.filter((c) => keys.includes(c));
  const rest = keys.filter((c) => !first.includes(c));
  return [...first, ...rest];
}
function renderPreview(rows, label = "") {
  state.previewRows = rows || [];
  state.previewLabel = label;
  const card = $("#previewCard");
  const table = $("#previewTable");
  table.innerHTML = "";
  if (!rows || !rows.length) {
    card.hidden = true;
    return;
  }
  const cols = orderedColumns(rows[0]);
  table.appendChild(el("thead", {}, el("tr", {}, cols.map((c) => el("th", { title: c }, fieldLabel(c))))));
  const tbody = el("tbody");
  rows.slice(0, 30).forEach((r) => {
    tbody.appendChild(el("tr", {}, cols.map((c) => {
      const v = cellText(r[c]);
      return el("td", { title: v }, v.length > 140 ? v.slice(0, 140) + "…" : v);
    })));
  });
  table.appendChild(tbody);
  $("#previewCount").textContent = `(상위 ${formatN(Math.min(30, rows.length))}행 · 총 ${formatN(rows.length)}행)`;
  $("#previewCaption").textContent = label || "";
  card.hidden = false;
}
function updateSummary(label = "") {
  $("#summaryCard").hidden = !state.stage1Rows.length && !state.finalRows.length;
  $("#stage1Count").textContent = `${formatN(state.stage1Rows.length)}명`;
  $("#finalCount").textContent = `${formatN(state.finalRows.length)}명`;
  $("#previewMode").textContent = label || state.previewLabel || "없음";
}
function saveExcel(rows, kind = "최종") {
  if (!rows || !rows.length) return;
  if (typeof XLSX === "undefined") {
    alert("XLSX 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
    return;
  }
  const cols = orderedColumns(rows[0]);
  const aoa = [cols.map((c) => fieldLabel(c))];
  rows.forEach((r) => aoa.push(cols.map((c) => (r[c] == null ? "" : r[c]))));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map((c) => ({ wch: Math.min(Math.max(fieldLabel(c).length + 8, 12), 48) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, kind === "1차" ? "stage1_candidates" : "final_personas");

  const meta = [
    ["항목", "값"],
    ["데이터셋", DATASET],
    ["config", state.config],
    ["split", state.split],
    ["구분", kind],
    ["행 수", rows.length],
    ["생성 시각", new Date().toLocaleString("ko-KR")],
  ];
  const metaWs = XLSX.utils.aoa_to_sheet(meta);
  metaWs["!cols"] = [{ wch: 18 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, metaWs, "meta");

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  XLSX.writeFile(wb, `한국_Nemotron_${kind}_${rows.length}_${stamp}.xlsx`);
}

// ---- 실행 / 초기화 ---------------------------------------------------
function cancelCollect() {
  if (!state.isCollecting) return;
  state.cancelRequested = true;
  setProgress("수집 취소 중… 현재 요청을 중단하고 있습니다.");
  if (state.activeController) state.activeController.abort();
}
function resetAll() {
  resetExactFilters();
  $("#maxN").value = String(HARD_CAP);
  $("#mode").value = "head";
  setColumnSelection("#stage2Columns", "text");
  state.stage1Rows = [];
  state.finalRows = [];
  state.previewRows = [];
  $("#previewCard").hidden = true;
  $("#summaryCard").hidden = true;
  $("#downloadStage1Btn").disabled = true;
  $("#downloadFinalBtn").disabled = true;
  setProgress("");
  setStage2Progress("");
  enableSecondary(false);
}
async function runStage1() {
  state.cancelRequested = false;
  state.activeController = new AbortController();
  state.stage1Rows = [];
  state.finalRows = [];
  setCollectingUI(true);
  setProgress("총원 확인 중…");
  setStage2Progress("");
  enableSecondary(false);
  try {
    const rows = await collectStage1();
    state.stage1Rows = rows;
    state.finalRows = [...rows];
    renderPreview(rows, "1차 후보 결과");
    updateSummary("1차 후보 결과");
    $("#downloadStage1Btn").disabled = rows.length === 0;
    $("#downloadFinalBtn").disabled = rows.length === 0;
    enableSecondary(rows.length > 0);
    if (rows.length) {
      setBanner(`1차 후보 수집 완료 — ${formatN(rows.length)}명을 프로그램 안에 보관했습니다. 이제 2차 내부 필터링을 적용할 수 있습니다.`, "ok");
      setStage2Progress("현재 최종 결과는 1차 후보 전체입니다. 2차 조건을 입력하고 필터를 적용하세요.");
    } else {
      setBanner("1차 후보가 수집되지 않았습니다. 정확 조건을 완화해 보세요.", "");
    }
  } catch (e) {
    console.error(e);
    if ((e.message || "").includes("취소")) {
      setProgress("수집이 취소되었습니다.");
      setBanner("수집을 취소했습니다. 조건을 바꾼 뒤 다시 실행할 수 있습니다.", "");
    } else {
      setProgress("");
      setBanner("데이터를 가져오지 못했습니다: " + (e.message || e) + " 네트워크를 확인하거나, 조건을 단순화하거나, 고급 설정에서 HF 토큰을 입력해 보세요.", "error");
    }
  } finally {
    state.activeController = null;
    state.cancelRequested = false;
    setCollectingUI(false);
    enableSecondary(state.stage1Rows.length > 0);
  }
}
async function init() {
  $("#datasetName").textContent = DATASET;
  $("#maxN").max = String(HARD_CAP);
  $("#maxN").value = String(HARD_CAP);
  try {
    await loadMeta();
  } catch (e) {
    console.error(e);
    setBanner("데이터 특성 정보를 불러오지 못했습니다. 기본 컬럼으로 진행합니다: " + (e.message || e), "error");
    state.allColumns = [...FALLBACK_COLUMNS];
    state.exactFields = [];
    $("#configSplit").textContent = `${state.config} / ${state.split}`;
    $("#sourceTotal").textContent = "확인 실패";
  }

  renderExactFilters(state.exactFields);
  renderColumnChecks("#stage2Columns", defaultKeywordCols());
  enableSecondary(false);

  $("#resetBtn").onclick = resetExactFilters;
  $("#runBtn").onclick = runStage1;
  $("#cancelBtn").onclick = cancelCollect;
  $("#downloadStage1Btn").onclick = () => saveExcel(state.stage1Rows, "1차");
  $("#filterStage2Btn").onclick = applyStage2Filter;
  $("#resetStage2Btn").onclick = resetStage2;
  $("#downloadFinalBtn").onclick = () => saveExcel(state.finalRows, "최종");
  $("#stage2ColsText").onclick = () => setColumnSelection("#stage2Columns", "text");
  $("#stage2ColsAll").onclick = () => setColumnSelection("#stage2Columns", "all");

  // 2차 모드가 '최소 N개'가 아닐 때도 값을 보존하되, 시각적으로만 비활성화한다.
  const syncMin = () => { $("#stage2Min").disabled = $("#stage2Mode").value !== "min"; };
  $("#stage2Mode").onchange = syncMin;
  syncMin();
}

document.addEventListener("DOMContentLoaded", init);
