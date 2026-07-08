/* =====================================================================
 * 한국인 페르소나 추출기 (브라우저 전용)
 * Hugging Face Dataset Viewer API를 사용해 nvidia/Nemotron-Personas-Korea
 * 데이터에서 원하는 특성의 사람을 최대 1000명 수집하여 엑셀로 저장한다.
 * 서버/빌드 도구가 필요 없는 순수 정적 파일이다.
 * ===================================================================== */

"use strict";

// ---- 데이터셋 설정 ---------------------------------------------------
const API = "https://datasets-server.huggingface.co";
const DATASET = "nvidia/Nemotron-Personas-Korea";
const CONFIG = "default";
const SPLIT = "train";
const PAGE = 100;          // API 요청당 최대 행 수
const HARD_CAP = 1000;     // 프로그램 최대 수집 인원

// ---- 필드 정의 -------------------------------------------------------
// control: "category"(다중선택) / "range"(나이) / "contains"(부분검색)
const FIELDS = [
  { col: "sex",             label: "성별",        control: "category" },
  { col: "age",             label: "나이",        control: "range" },
  { col: "marital_status",  label: "혼인상태",    control: "category" },
  { col: "military_status", label: "병역상태",    control: "category" },
  { col: "education_level", label: "학력",        control: "category" },
  { col: "bachelors_field", label: "전공계열",    control: "category" },
  { col: "family_type",     label: "가족형태",    control: "category" },
  { col: "housing_type",    label: "주거형태",    control: "category" },
  { col: "province",        label: "시도(지역)",  control: "category" },
  { col: "district",        label: "시군구",      control: "contains" },
  { col: "occupation",      label: "직업",        control: "contains" },
];

// category 필드의 대체 기본값 (통계 API 실패 시 사용)
const FALLBACK_OPTIONS = {
  sex: ["남자", "여자"],
  marital_status: ["미혼", "배우자있음", "이혼", "사별"],
  military_status: ["현역", "비현역"],
};

// 엑셀 헤더용 한글 라벨 & 우선 컬럼 순서
const COLUMN_LABELS = {
  uuid: "고유ID", sex: "성별", age: "나이", marital_status: "혼인상태",
  military_status: "병역상태", family_type: "가족형태", housing_type: "주거형태",
  education_level: "학력", bachelors_field: "전공계열", occupation: "직업",
  district: "시군구", province: "시도", country: "국가", persona: "페르소나(요약)",
  professional_persona: "직업 페르소나", family_persona: "가족 페르소나",
  sports_persona: "스포츠 페르소나", arts_persona: "예술 페르소나",
  travel_persona: "여행 페르소나", culinary_persona: "음식 페르소나",
  cultural_background: "문화적 배경", skills_and_expertise: "기술 및 전문성",
  hobbies_and_interests: "취미 및 관심사", career_goals_and_ambitions: "경력 목표",
};
const PREFERRED_ORDER = [
  "uuid", "sex", "age", "marital_status", "military_status", "family_type",
  "housing_type", "education_level", "bachelors_field", "occupation",
  "district", "province", "persona",
];

// ---- 상태 ------------------------------------------------------------
const state = {
  category: {},   // { col: [선택값...] }
  contains: {},   // { col: "검색어" }
  ageMin: "",
  ageMax: "",
  ageBounds: { min: 19, max: 99 },
  lastRows: [],
};

// ---- DOM 헬퍼 --------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
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

// ---- SQL / URL 빌더 (단위 테스트 완료된 로직) ------------------------
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
  if (state.ageMin !== "" && state.ageMin != null)
    parts.push(`${q("age")} >= ${parseInt(state.ageMin, 10)}`);
  if (state.ageMax !== "" && state.ageMax != null)
    parts.push(`${q("age")} <= ${parseInt(state.ageMax, 10)}`);
  return parts.join(" AND ");
}

function buildUrl(where, offset, length) {
  const common =
    `dataset=${encodeURIComponent(DATASET)}&config=${encodeURIComponent(CONFIG)}` +
    `&split=${encodeURIComponent(SPLIT)}&offset=${offset}&length=${length}`;
  return where && where.length
    ? `${API}/filter?${common}&where=${encodeURIComponent(where)}`
    : `${API}/rows?${common}`;
}

// ---- 네트워크 (재시도 포함) ------------------------------------------
function authHeaders() {
  const t = ($("#token").value || "").trim();
  return t ? { Authorization: "Bearer " + t } : {};
}

async function fetchJson(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: authHeaders(), mode: "cors" });
      if (res.status === 429) {           // rate limit -> 대기 후 재시도
        await sleep(1200 * (i + 1));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(600 * (i + 1));
    }
  }
  throw lastErr;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mapRows = (rows) => (rows || []).map((r) => (r && r.row ? r.row : r));

// ---- 통계로 카테고리 옵션 & 나이 범위 로드 ---------------------------
async function loadStatistics() {
  const url = `${API}/statistics?dataset=${encodeURIComponent(DATASET)}` +
    `&config=${encodeURIComponent(CONFIG)}&split=${encodeURIComponent(SPLIT)}`;
  const data = await fetchJson(url, 2);
  const stats = data.statistics || [];
  const options = {};
  let total = data.num_examples || null;

  for (const s of stats) {
    const col = s.column_name;
    const cs = s.column_statistics || {};
    // 카테고리형: frequencies / value_counts / categories 중 존재하는 것 사용
    const freq = cs.frequencies || cs.value_counts || null;
    if (freq && typeof freq === "object") {
      options[col] = Object.keys(freq).sort((a, b) => a.localeCompare(b, "ko"));
    } else if (Array.isArray(cs.categories)) {
      options[col] = cs.categories.slice().sort((a, b) => String(a).localeCompare(String(b), "ko"));
    }
    if (col === "age") {
      if (typeof cs.min === "number") state.ageBounds.min = cs.min;
      if (typeof cs.max === "number") state.ageBounds.max = cs.max;
    }
  }
  return { options, total };
}

// ---- UI 렌더링 -------------------------------------------------------
function renderFilters(optionMap) {
  const root = $("#filters");
  root.innerHTML = "";

  for (const f of FIELDS) {
    const wrap = el("div", { class: "field" });
    wrap.appendChild(el("label", { class: "title" }, f.label));

    if (f.control === "range") {
      state.ageMin = state.ageBounds.min;
      state.ageMax = state.ageBounds.max;
      const min = el("input", { type: "number", value: String(state.ageBounds.min),
        min: String(state.ageBounds.min), max: String(state.ageBounds.max) });
      const max = el("input", { type: "number", value: String(state.ageBounds.max),
        min: String(state.ageBounds.min), max: String(state.ageBounds.max) });
      min.oninput = () => { state.ageMin = min.value; };
      max.oninput = () => { state.ageMax = max.value; };
      const row = el("div", { class: "age-row" }, [min, el("span", {}, "~"), max]);
      wrap.appendChild(row);
      wrap.appendChild(el("div", { class: "hint" }, "세 단위 범위" ));
    }

    else if (f.control === "category") {
      let opts = optionMap[f.col] || FALLBACK_OPTIONS[f.col] || null;
      if (opts && opts.length) {
        wrap.appendChild(buildMultiSelect(f.col, opts));
      } else {
        // 옵션을 못 얻으면 포함검색으로 대체
        wrap.appendChild(buildContains(f.col, "예: 값 일부 입력"));
        wrap.appendChild(el("div", { class: "hint" }, "목록을 불러오지 못해 부분검색으로 제공"));
      }
    }

    else { // contains
      const ph = f.col === "occupation" ? "예: 교사 / 의사 / 개발 / 운전"
        : f.col === "district" ? "예: 강남구 / 해운대구 / 전주"
        : "일부 단어 입력";
      wrap.appendChild(buildContains(f.col, ph));
      wrap.appendChild(el("div", { class: "hint" }, "부분검색 (포함되면 매칭)"));
    }

    root.appendChild(wrap);
  }
}

function buildContains(col, placeholder) {
  const inp = el("input", { type: "text", placeholder });
  inp.oninput = () => { state.contains[col] = inp.value; };
  return inp;
}

function buildMultiSelect(col, options) {
  state.category[col] = state.category[col] || [];
  const box = el("div", { class: "multi" });
  const search = el("input", { class: "search", type: "text", placeholder: "검색…" });
  const list = el("div", { class: "list" });
  const count = el("div", { class: "count" }, "선택 0개");

  function draw(filterText) {
    list.innerHTML = "";
    const ft = (filterText || "").trim();
    const shown = ft ? options.filter((o) => o.includes(ft)) : options;
    if (!shown.length) { list.appendChild(el("div", { class: "empty" }, "결과 없음")); return; }
    shown.forEach((opt) => {
      const cb = el("input", { type: "checkbox" });
      cb.checked = state.category[col].includes(opt);
      cb.onchange = () => {
        const set = new Set(state.category[col]);
        cb.checked ? set.add(opt) : set.delete(opt);
        state.category[col] = [...set];
        count.textContent = `선택 ${state.category[col].length}개`;
      };
      list.appendChild(el("label", { class: "opt" }, [cb, document.createTextNode(opt)]));
    });
  }
  search.oninput = () => draw(search.value);
  draw("");
  count.textContent = `선택 ${state.category[col].length}개`;
  box.appendChild(search); box.appendChild(list); box.appendChild(count);
  return box;
}

// ---- 수집 실행 -------------------------------------------------------
async function collect() {
  const where = buildWhere();
  let maxN = Math.min(parseInt($("#maxN").value, 10) || HARD_CAP, HARD_CAP);
  const mode = $("#mode").value;

  // 1) 매칭 총원 확인 (length=1)
  const probe = await fetchJson(buildUrl(where, 0, 1));
  const total = probe.num_rows_total != null ? probe.num_rows_total : null;
  const partial = probe.partial === true;

  if (total === 0) {
    setProgress("조건에 맞는 사람이 없습니다. 조건을 완화해 보세요.");
    return [];
  }

  // 2) 시작 오프셋 결정
  let startOffset = 0;
  if (mode === "random" && total && total > maxN) {
    startOffset = Math.floor(Math.random() * (total - maxN));
  }

  // 3) 페이지네이션 수집
  const rows = [];
  let offset = startOffset;
  while (rows.length < maxN) {
    const need = Math.min(PAGE, maxN - rows.length);
    const data = await fetchJson(buildUrl(where, offset, need));
    const got = mapRows(data.rows);
    rows.push(...got);
    setProgress(`수집 중… ${rows.length.toLocaleString()} / ${Math.min(maxN, total || maxN).toLocaleString()}명`
      + (partial ? "  (부분 인덱스)" : ""));
    if (got.length < need) break;               // 더 이상 없음
    offset += need;
    if (total != null && offset >= total) break; // 끝 도달
  }

  const finalRows = rows.slice(0, maxN);
  const totalTxt = total != null ? total.toLocaleString() : "?";
  setProgress(`완료 — 조건에 맞는 전체 ${totalTxt}명 중 ${finalRows.length.toLocaleString()}명 수집`
    + (partial ? "  · 데이터가 커서 일부 구간만 인덱싱되었습니다." : ""));
  return finalRows;
}

function setProgress(msg) { $("#progress").textContent = msg; }

// ---- 미리보기 --------------------------------------------------------
function renderPreview(rows) {
  const card = $("#previewCard");
  const table = $("#previewTable");
  table.innerHTML = "";
  if (!rows.length) { card.hidden = true; return; }

  const cols = orderedColumns(rows[0]);
  const thead = el("thead", {}, el("tr", {}, cols.map((c) =>
    el("th", {}, COLUMN_LABELS[c] || c))));
  const tbody = el("tbody");
  rows.slice(0, 20).forEach((r) => {
    tbody.appendChild(el("tr", {}, cols.map((c) => {
      const v = r[c] == null ? "" : String(r[c]);
      const td = el("td", { title: v }, v.length > 120 ? v.slice(0, 120) + "…" : v);
      return td;
    })));
  });
  table.appendChild(thead); table.appendChild(tbody);
  $("#previewCount").textContent = `(상위 ${Math.min(20, rows.length)}행 표시 · 총 ${rows.length.toLocaleString()}행)`;
  card.hidden = false;
}

function orderedColumns(sample) {
  const keys = Object.keys(sample);
  const first = PREFERRED_ORDER.filter((c) => keys.includes(c));
  const rest = keys.filter((c) => !first.includes(c));
  return [...first, ...rest];
}

// ---- 엑셀 저장 -------------------------------------------------------
function saveExcel(rows) {
  if (!rows.length) return;
  const cols = orderedColumns(rows[0]);
  const aoa = [cols.map((c) => COLUMN_LABELS[c] || c)];
  rows.forEach((r) => aoa.push(cols.map((c) => (r[c] == null ? "" : r[c]))));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map((c) => ({ wch: Math.min((COLUMN_LABELS[c] || c).length + 8, 40) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "personas");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  XLSX.writeFile(wb, `personas_${rows.length}_${stamp}.xlsx`);
}

// ---- 초기화 ----------------------------------------------------------
async function init() {
  // 필터 UI를 먼저 대체 옵션으로 그려서 통계 실패해도 동작하게 함
  renderFilters({});

  try {
    const { options, total } = await loadStatistics();
    renderFilters(options);
    setBanner(
      `데이터 준비 완료 — 전체 약 ${total ? total.toLocaleString() : "100만"}명. 특성을 선택하세요.`,
      "ok"
    );
  } catch (e) {
    console.warn(e);
    setBanner(
      "카테고리 목록을 불러오지 못해 기본값/부분검색으로 진행합니다. 수집은 정상 동작합니다.",
      ""
    );
  }

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
      setBanner(
        "데이터를 가져오지 못했습니다: " + (e.message || e) +
        "  네트워크 연결을 확인하거나, 조건을 단순화하거나, 고급 설정에서 HF 토큰을 입력해 보세요.",
        "error"
      );
    } finally {
      btn.disabled = false;
    }
  };

  $("#downloadBtn").onclick = () => saveExcel(state.lastRows);

  $("#resetBtn").onclick = () => {
    state.category = {}; state.contains = {};
    state.ageMin = state.ageBounds.min; state.ageMax = state.ageBounds.max;
    $("#previewCard").hidden = true; setProgress(""); $("#downloadBtn").disabled = true;
    init();
  };
}

document.addEventListener("DOMContentLoaded", init);
