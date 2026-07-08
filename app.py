"""
app.py
------
Nemotron-Personas-Korea 데이터셋에서 원하는 특성을 클릭으로 골라
최대 1,000명을 추출하고 엑셀로 내려받는 Streamlit 웹 앱.

실행:  streamlit run app.py
"""

from __future__ import annotations

import io

import pandas as pd
import streamlit as st

import persona_filter as pf

# ----------------------------------------------------------------------------
# 데이터 로드 (캐시). 최초 1회만 Hugging Face에서 내려받고 이후 메모리 캐시 사용.
# 메모리가 부족하면 아래 LOAD_COLUMNS 를 pf.LIGHT_COLUMNS 로 바꾸세요.
# ----------------------------------------------------------------------------
LOAD_COLUMNS = None  # None = 전체 컬럼 로드 (페르소나 텍스트 포함). 예: pf.LIGHT_COLUMNS


@st.cache_data(show_spinner=True)
def get_data() -> pd.DataFrame:
    return pf.load_data(columns=LOAD_COLUMNS)


@st.cache_data(show_spinner=False)
def unique_values(col: str) -> list[str]:
    df = get_data()
    if col not in df.columns:
        return []
    vals = sorted(v for v in df[col].dropna().unique().tolist())
    return vals


st.set_page_config(page_title="한국인 페르소나 추출기", page_icon="🇰🇷", layout="wide")
st.title("🇰🇷 Nemotron-Personas-Korea 페르소나 추출기")
st.caption(
    "NVIDIA의 한국인 합성 페르소나 100만 건에서 원하는 특성을 골라 "
    "최대 1,000명을 추출하고 엑셀로 저장합니다."
)

with st.spinner("데이터셋을 불러오는 중입니다... (최초 실행 시 약 2GB 다운로드)"):
    df = get_data()

st.success(f"데이터 로드 완료 — 총 {len(df):,}건")

# ----------------------------------------------------------------------------
# 사이드바: 특성 선택 필터
# ----------------------------------------------------------------------------
st.sidebar.header("🔎 특성 선택")

sel = {}

sel["sex"] = st.sidebar.multiselect("성별", unique_values("sex"))

age_min, age_max = st.sidebar.slider(
    "나이대", min_value=int(df["age"].min()), max_value=int(df["age"].max()),
    value=(int(df["age"].min()), int(df["age"].max())),
)

sel["marital_status"] = st.sidebar.multiselect("혼인상태", unique_values("marital_status"))
sel["military_status"] = st.sidebar.multiselect("병역상태", unique_values("military_status"))
sel["education_level"] = st.sidebar.multiselect("학력", unique_values("education_level"))
sel["bachelors_field"] = st.sidebar.multiselect("전공계열", unique_values("bachelors_field"))
sel["housing_type"] = st.sidebar.multiselect("주거형태", unique_values("housing_type"))

# 가족형태: 종류가 많아 선택 + 부분검색 모두 제공
sel["family_type"] = st.sidebar.multiselect("가족형태 (직접 선택)", unique_values("family_type"))
family_type_contains = st.sidebar.text_input(
    "가족형태 부분검색", placeholder="예: 자녀 / 부모 / 혼자"
)

# 직업: 부분검색(권장) + 완전일치 선택
occupation_contains = st.sidebar.text_input(
    "직업 부분검색", placeholder="예: 교사 / 의사 / 운전 / 개발"
)
sel["occupation_in"] = st.sidebar.multiselect(
    "직업 (직접 선택, 선택사항)", unique_values("occupation")
)

# 지역: 시도 선택 -> 해당 시도의 시군구만 노출
sel["province"] = st.sidebar.multiselect("시도", unique_values("province"))
if sel["province"]:
    district_opts = sorted(
        df.loc[df["province"].isin(sel["province"]), "district"].dropna().unique().tolist()
    )
else:
    district_opts = unique_values("district")
sel["district"] = st.sidebar.multiselect("시군구", district_opts)

st.sidebar.divider()
max_results = st.sidebar.number_input(
    "최대 인원 (1~1000)", min_value=1, max_value=1000, value=1000, step=50
)
sample = st.sidebar.checkbox(
    "1000명 초과 시 무작위 표본 추출", value=True,
    help="체크 해제 시 앞에서부터 순서대로 추출합니다.",
)

# ----------------------------------------------------------------------------
# 필터 실행
# ----------------------------------------------------------------------------
result = pf.apply_filters(
    df,
    sex=sel["sex"],
    age_min=age_min,
    age_max=age_max,
    marital_status=sel["marital_status"],
    military_status=sel["military_status"],
    family_type=sel["family_type"],
    family_type_contains=family_type_contains or None,
    housing_type=sel["housing_type"],
    education_level=sel["education_level"],
    bachelors_field=sel["bachelors_field"],
    occupation_in=sel["occupation_in"],
    occupation_contains=occupation_contains or None,
    province=sel["province"],
    district=sel["district"],
    max_results=int(max_results),
    sample=sample,
)

# 조건에 맞는 전체 인원(상한 적용 전) 계산
full_count = len(
    pf.apply_filters(
        df,
        sex=sel["sex"], age_min=age_min, age_max=age_max,
        marital_status=sel["marital_status"], military_status=sel["military_status"],
        family_type=sel["family_type"], family_type_contains=family_type_contains or None,
        housing_type=sel["housing_type"], education_level=sel["education_level"],
        bachelors_field=sel["bachelors_field"], occupation_in=sel["occupation_in"],
        occupation_contains=occupation_contains or None,
        province=sel["province"], district=sel["district"],
        max_results=None,
    )
)

c1, c2 = st.columns(2)
c1.metric("조건에 맞는 전체 인원", f"{full_count:,} 명")
c2.metric("추출된 인원 (엑셀 저장 대상)", f"{len(result):,} 명")

if full_count > len(result):
    st.info(
        f"조건에 맞는 사람은 {full_count:,}명이지만 상한({int(max_results):,}명)에 맞춰 "
        f"{'무작위로' if sample else '앞에서부터'} {len(result):,}명만 추출했습니다."
    )

# ----------------------------------------------------------------------------
# 출력 컬럼 선택 + 미리보기 + 다운로드
# ----------------------------------------------------------------------------
st.subheader("엑셀에 저장할 항목")
default_out = [c for c in pf.LIGHT_COLUMNS if c in df.columns]
out_cols = st.multiselect(
    "저장할 컬럼을 고르세요",
    options=[c for c in pf.ALL_COLUMNS if c in df.columns],
    default=default_out,
    format_func=lambda c: f"{pf.COLUMN_LABELS.get(c, c)} ({c})",
)

st.subheader("미리보기")
if len(result):
    preview = result[out_cols].rename(columns=pf.COLUMN_LABELS) if out_cols else result
    st.dataframe(preview.head(50), use_container_width=True)
else:
    st.warning("조건에 맞는 사람이 없습니다. 필터를 완화해 보세요.")

if len(result) and out_cols:
    buffer = io.BytesIO()
    tmp = result[out_cols].rename(columns=pf.COLUMN_LABELS)
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        tmp.to_excel(writer, index=False, sheet_name="personas")
    buffer.seek(0)
    st.download_button(
        "📥 엑셀(.xlsx) 다운로드",
        data=buffer,
        file_name="personas.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        type="primary",
    )
