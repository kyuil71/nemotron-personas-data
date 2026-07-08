/* =====================================================================
 * Nemotron-Personas 추출기 (브라우저 전용)
 * 국가를 선택하면 해당 국가의 Hugging Face 데이터셋에 연결하여,
 * 원하는 특성의 인물을 최대 1,000명 수집해 엑셀로 저장한다.
 * 서버/빌드 도구가 필요 없는 순수 정적 파일이다.
 * ===================================================================== */
"use strict";

// ---- 공통 설정 -------------------------------------------------------
const API = "https://datasets-server.huggingface.co";
const PAGE = 100;         // 요청당 최대 행 수
const HARD_CAP = 1000;    // 최대 수집 인원
const CAT_MAX = 60;       // 이 값 이하의 고유값이면 선택 목록(카테고리)로 표시
const ANY_LABEL = "상관 없음";

// 국가별 데이터 소스
const COUNTRIES = [
  { name: "한국",     dataset: "nvidia/Nemotron-Personas-Korea",       size: "700만 명 · Korean" },
  { name: "미국",     dataset: "nvidia/Nemotron-Personas-USA",         size: "600만 명 · American English" },
  { name: "일본",     dataset: "nvidia/Nemotron-Personas-Japan",       size: "600만 명 · Japanese" },
  { name: "인도",     dataset: "nvidia/Nemotron-Personas-India",       size: "2,100만 명 · Hindi / Indian English" },
  { name: "싱가포르", dataset: "nvidia/Nemotron-Personas-Singapore",   size: "88.8만 명 · English" },
  { name: "브라질",   dataset: "nvidia/Nemotron-Personas-Brazil",      size: "600만 명 · Brazilian Portuguese" },
  { name: "프랑스",   dataset: "nvidia/Nemotron-Personas-France",      size: "600만 명 · French" },
  { name: "엘살바도르", dataset: "nvidia/Nemotron-Personas-El-Salvador", size: "100만 명 · Salvadoran Spanish" },
  { name: "베트남",   dataset: "nvidia/Nemotron-Personas-Vietnam",     size: "60만 명 · Vietnamese" },
  { name: "벨기에",   dataset: "nvidia/Nemotron-Personas-Belgium",     size: "30만 명" },
];

// 부분검색(텍스트)로 다룰 컬럼 (고유값이 많을 때). 지역·직업류
const TEXT_COLS = new Set([
  "occupation", "district", "city", "municipality", "commune", "locality",
  "ward", "name", "county", "department", "neighborhood",
  "state", "province", "region", "prefecture", "sido", "sigungu",
]);

// 필터 표시 순서 (알려진 컬럼 우선, 나머지는 뒤로)
const ORDER = [
  "sex", "age", "marital_status", "military_status", "education_level",
  "education", "bachelors_field", "family_type", "housing_type",
  "region", "province", "state", "prefecture", "district", "city", "occupation",
];
const ord = (c) => { const i = ORDER.indexOf(c); return i < 0 ? 999 : i; };

// 컬럼 -> 한글 라벨 (없으면 원래 컬럼명 사용)
const LABELS = {
  uuid: "고유ID", sex: "성별", age: "나이", marital_status: "혼인상태",
  military_status: "병역상태", education_level: "학력", education: "학력",
  bachelors_field: "전공계열", occupation: "직업", family_type: "가족형태",
  housing_type: "주거형태", province: "시도", district: "시군구", region: "지역",
  state: "주/지역", prefecture: "현", department: "데파르트망", commune: "코뮌",
  municipality: "시읍면", city: "도시", county: "카운티", country: "국가",
  persona: "페르소나(요약)", professional_persona: "직업 페르소나",
  family_persona: "가족 페르소나", cultural_background: "문화적 배경",
  skills_and_expertise: "기술 및 전문성", hobbies_and_interests: "취미 및 관심사",
  career_goals_and_ambitions: "경력 목표",
};
const label = (c) => LABELS[c] || c;

const PREFERRED_ORDER = [
  "uuid", "sex", "age", "marital_status", "military_status", "family_type",
  "housing_type", "education_level", "education", "bachelors_field",
  "occupation", "district", "city", "region", "state", "province", "persona",
];

// ---- 상태 ------------------------------------------------------------
const state = {
  dataset: COUNTRIES[0].dataset,
  config: "default",
  split: "train",
  fields: [],
  category: {},   // { col: [선택값...] }  (빈 배열 = 상관 없음)
  contains: {},   // { col: "검색어" }
  ageAny: true,
  ageMin: "",
  ageMax: "",
  ageBounds: { min: 0, max: 120 },
  lastRows: [],
};

// ---- DOM 헬퍼 --------------------------------------------------------
const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
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

// ---- SQL / URL 빌더 --------------------------------------------------
const sqlStr = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const q = (col) => '"' + col + '"';

function buildWhere() {
  const parts = [];
  for (const [col, vals] of Object.entries(state.category)) {
    const arr = (vals || []).filter((x) => x !== "" && x != null);
    if (arr.length)
      parts.push("(" + arr.map((v) => `${q(col)} = ${sqlStr(v)}`).join(" OR ") + ")");
  }
  for (const [col, text] of Object.entries(state.contains)) {
    const t = (text || "").trim();
    if (t) parts.push(`${q(col)} LIKE ${sqlStr("%" + t + "%")}`);
  }
  if (!state.ageAny) {
    if (state.ageMin !== "" && state.ageMin != null)
      parts.push(`${q("age")} >= ${parseInt(state.ageMin, 10)}`);
    if (state.ageMax !== "" && state.ageMax != null)
      parts.push(`${q("age")} <= ${parseInt(state.ageMax, 10)}`);
  }
  return parts.join(" AND ");
}

function buildUrl(where, offset, length) {
  const common =
    `dataset=${encodeURIComponent(state.dataset)}&config=${encodeURIComponent(state.config)}` +
    `&split=${encodeURIComponent(state.split)}&offset=${offset}&length=${length}`;
  return where && where.length
    ? `${API}/filter?${common}&where=${encodeURIComponent(where)}`
    : `${API}/rows?${common}`;
}

// ---- 네트워크 (재시도 포함) ------------------------------------------
function authHeaders() {
  const t = ($("#token").value || "").trim();
  return t ? { Authorization: "Bearer " + t } : {};
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mapRows = (rows) => (rows || []).map((r) => (r && r.row ? r.row : r));

async function fetchJson(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: authHeaders(), mode: "cors" });
      if (res.status === 429) { await sleep(1200 * (i + 1)); continue; }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${body.slice(0, 160)}`);
      }
      return await res.json();
    } catch (e) { lastErr = e; await sleep(600 * (i + 1)); }
  }
  throw lastErr;
}

// ---- 데이터셋 메타 로드 (config/split 해석 + 통계로 필드 구성) --------
async function resolveConfigSplit(dataset) {
  try {
    const s = await fetchJson(`${API}/splits?dataset=${encodeURIComponent(dataset)}`, 2);
    const arr = s.splits || [];
    if (arr.length) {
      const t = arr.find((x) => x.split === "train") || arr[0];
      return { config: t.config, split: t.split };
    }
  } catch (e) { /* 기본값 사용 */ }
  return { config: "default", split: "train" };
}

function classify(col, cs) {
  if (col === "age") return "range";
  const freq = cs.frequencies || cs.value_counts || null;
  let n = cs.n_unique;
  if (freq && n == null) n = Object.keys(freq).length;
  if (freq && n >= 2 && n <= CAT_MAX)
    return { type: "category", options: Object.keys(freq) };
  if (TEXT_COLS.has(col)) return "contains";
  return null;
}

function buildFields(stats) {
  const fields = [];
  let ageBounds = null;
  for (const s of stats) {
    const col = s.column_name;
    const cs = s.column_statistics || {};
    if (col === "age") {
      ageBounds = { min: (typeof cs.min === "number" ? cs.min : 0),
                    max: (typeof cs.max === "number" ? cs.max : 120) };
      fields.push({ col, control: "range" });
      continue;
    }
    const c = classify(col, cs);
    if (!c) continue;
    if (c === "contains") fields.push({ col, control: "contains" });
    else if (c.type === "category")
      fields.push({ col, control: "category",
        options: c.options.slice().sort((a, b) => String(a).localeCompare(String(b), "ko")) });
  }
  fields.sort((a, b) => ord(a.col) - ord(b.col));
  return { fields, ageBounds };
}

async function loadMeta(dataset) {
  const { config, split } = await resolveConfigSplit(dataset);
  const url = `${API}/statistics?dataset=${encodeURIComponent(dataset)}` +
    `&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}`;
  const data = await fetchJson(url, 2);
  const { fields, ageBounds } = buildFields(data.statistics || []);
  return { config, split, total: data.num_examples ?? null, fields, ageBounds };
}

// ---- 국가 선택 -------------------------------------------------------
async function selectCountry(dataset) {
  const c = COUNTRIES.find((x) => x.dataset === dataset) || COUNTRIES[0];
  // 상태 초기화
  state.dataset = dataset;
  state.category = {}; state.contains = {}; state.ageAny = true;
  state.lastRows = [];
  $("#previewCard").hidden = true; $("#downloadBtn").disabled = true; setProgress("");
  $("#countryMeta").textContent = `${c.name} · ${c.size}`;
  $("#filters").innerHTML = "";
  setBanner(`${c.name} 데이터에 연결하는 중…`, "");

  try {
    const meta = await loadMeta(dataset);
    state.config = meta.config; state.split = meta.split;
    state.ageBounds = meta.ageBounds || { min: 0, max: 120 };
    state.ageMin = state.ageBounds.min; state.ageMax = state.ageBounds.max;
    state.fields = meta.fields;
    renderFilters(meta.fields);
    const tot = meta.total != null ? meta.total.toLocaleString() : "다수";
    setBanner(`${c.name} 준비 완료 — 소스에 약 ${tot}명. 특성을 선택하세요.`, "ok");
    if (meta.total != null) $("#countryMeta").textContent = `${c.name} · ${c.size} · 소스 ${tot}명`;
  } catch (e) {
    console.warn(e);
    state.config = "default"; state.split = "train";
    state.fields = [];
    renderFilters([]);
    setBanner(
      `${c.name}의 특성 목록을 불러오지 못했습니다. 조건 없이 수집하거나 잠시 후 다시 시도하세요. (${e.message || e})`,
      "error"
    );
  }
}

// ---- 필터 UI ---------------------------------------------------------
function renderFilters(fields) {
  const root = $("#filters");
  root.innerHTML = "";
  if (!fields.length) {
    root.appendChild(el("p", { class: "fine" },
      "표시할 특성이 없습니다. 아래에서 바로 수집하면 소스 앞부분부터 인원을 가져옵니다."));
    return;
  }
  for (const f of fields) {
    const wrap = el("div", { class: "field" });
    wrap.appendChild(el("label", { class: "title" }, label(f.col)));

    if (f.control === "range") {
      wrap.appendChild(buildRange());
      wrap.appendChild(el("div", { class: "hint" }, "나이 범위"));
    } else if (f.control === "category") {
      wrap.appendChild(buildMultiSelect(f.col, f.options));
    } else {
      const ph = f.col === "occupation" ? "예: 교사 / 의사 / 개발"
        : "일부 단어 입력";
      wrap.appendChild(buildContains(f.col, ph));
      wrap.appendChild(el("div", { class: "hint" }, "단어 포함 검색 · 비워두면 상관 없음"));
    }
    root.appendChild(wrap);
  }
}

function buildRange() {
  const b = state.ageBounds;
  state.ageMin = b.min; state.ageMax = b.max;
  const min = el("input", { type: "number", value: String(b.min), min: String(b.min), max: String(b.max) });
  const max = el("input", { type: "number", value: String(b.max), min: String(b.min), max: String(b.max) });
  min.oninput = () => { state.ageMin = min.value; };
  max.oninput = () => { state.ageMax = max.value; };
  const row = el("div", { class: "age-row" }, [min, el("span", {}, "~"), max]);

  const anyCb = el("input", { type: "checkbox" });
  anyCb.checked = state.ageAny;
  const applyAny = () => {
    state.ageAny = anyCb.checked;
    min.disabled = max.disabled = anyCb.checked;
    row.classList.toggle("disabled", anyCb.checked);
  };
  anyCb.onchange = applyAny;
  const anyRow = el("label", { class: "opt any" }, [anyCb, document.createTextNode(ANY_LABEL)]);
  const box = el("div", { class: "rangebox" }, [anyRow, el("div", { class: "rangebody" }, row)]);
  applyAny();
  return box;
}

function buildContains(col, placeholder) {
  const inp = el("input", { type: "text", placeholder });
  inp.value = state.contains[col] || "";
  inp.oninput = () => { state.contains[col] = inp.value; };
  return inp;
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
    } else {
      anyCb.checked = true;   // 스스로는 끌 수 없음 (특정 값 선택으로만 해제)
    }
  };

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
    list.appendChild(el("label", { class: "opt" }, [cb, document.createTextNode(opt)]));
  });

  syncAny();
  box.appendChild(anyRow);
  box.appendChild(list);
  return box;
}

// ---- 수집 실행 -------------------------------------------------------
function setProgress(msg) { $("#progress").textContent = msg; }

async function collect() {
  const where = buildWhere();
  const maxN = Math.min(parseInt($("#maxN").value, 10) || HARD_CAP, HARD_CAP);
  const mode = $("#mode").value;

  const probe = await fetchJson(buildUrl(where, 0, 1));
  const total = probe.num_rows_total != null ? probe.num_rows_total : null;
  const partial = probe.partial === true;
  if (total === 0) { setProgress("조건에 맞는 사람이 없습니다. 조건을 완화해 보세요."); return []; }

  let offset = 0;
  if (mode === "random" && total && total > maxN)
    offset = Math.floor(Math.random() * (total - maxN));

  const rows = [];
  while (rows.length < maxN) {
    const need = Math.min(PAGE, maxN - rows.length);
    const data = await fetchJson(buildUrl(where, offset, need));
    const got = mapRows(data.rows);
    rows.push(...got);
    setProgress(`수집 중… ${rows.length.toLocaleString()} / ${Math.min(maxN, total || maxN).toLocaleString()}명`
      + (partial ? "  (부분 인덱스)" : ""));
    if (got.length < need) break;
    offset += need;
    if (total != null && offset >= total) break;
  }
  const finalRows = rows.slice(0, maxN);
  const totalTxt = total != null ? total.toLocaleString() : "?";
  setProgress(`완료 — 조건에 맞는 ${totalTxt}명 중 ${finalRows.length.toLocaleString()}명 수집`
    + (partial ? " · 데이터가 커서 일부 구간만 인덱싱되었습니다." : ""));
  return finalRows;
}

// ---- 미리보기 / 엑셀 -------------------------------------------------
function orderedColumns(sample) {
  const keys = Object.keys(sample);
  const first = PREFERRED_ORDER.filter((c) => keys.includes(c));
  const rest = keys.filter((c) => !first.includes(c));
  return [...first, ...rest];
}

function renderPreview(rows) {
  const card = $("#previewCard");
  const table = $("#previewTable");
  table.innerHTML = "";
  if (!rows.length) { card.hidden = true; return; }
  const cols = orderedColumns(rows[0]);
  table.appendChild(el("thead", {}, el("tr", {}, cols.map((c) => el("th", {}, label(c))))));
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
  const aoa = [cols.map((c) => label(c))];
  rows.forEach((r) => aoa.push(cols.map((c) => (r[c] == null ? "" : r[c]))));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map((c) => ({ wch: Math.min(label(c).length + 8, 40) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "personas");
  const country = (COUNTRIES.find((x) => x.dataset === state.dataset) || {}).name || "personas";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  XLSX.writeFile(wb, `${country}_${rows.length}_${stamp}.xlsx`);
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

  $("#runBtn").onclick = async () => {
    const btn = $("#runBtn");
    btn.disabled = true; $("#downloadBtn").disabled = true;
    setProgress("총원 확인 중…");
    try {
      const rows = await collect();
      state.lastRows = rows;
      renderPreview(rows);
      $("#downloadBtn").disabled = rows.length === 0;
    } catch (e) {
      console.error(e);
      setProgress("");
      setBanner("데이터를 가져오지 못했습니다: " + (e.message || e) +
        "  네트워크를 확인하거나, 조건을 단순화하거나, 고급 설정에서 HF 토큰을 입력해 보세요.", "error");
    } finally { btn.disabled = false; }
  };

  $("#downloadBtn").onclick = () => saveExcel(state.lastRows);

  $("#resetBtn").onclick = () => {
    state.category = {}; state.contains = {}; state.ageAny = true;
    state.ageMin = state.ageBounds.min; state.ageMax = state.ageBounds.max;
    $("#previewCard").hidden = true; setProgress(""); $("#downloadBtn").disabled = true;
    renderFilters(state.fields);
  };

  await selectCountry(state.dataset);
}

document.addEventListener("DOMContentLoaded", init);
