"""
persona_filter.py
-----------------
NVIDIA Nemotron-Personas-Korea 데이터셋을 불러오고, 원하는 특성으로
필터링한 뒤 결과를 반환하거나 엑셀로 저장하는 핵심 로직 모듈.

앱(app.py, filter_cli.py)에서 이 모듈을 공통으로 사용합니다.
"""

from __future__ import annotations

from typing import Iterable, Optional, Sequence

import pandas as pd

# Hugging Face 데이터셋 ID
DATASET_ID = "nvidia/Nemotron-Personas-Korea"

# 선택형(카테고리) 필터로 쓸 수 있는 컬럼들 - 값의 종류가 정해져 있음
CATEGORICAL_COLUMNS = [
    "sex",              # 성별: 남자 / 여자
    "marital_status",   # 혼인상태: 미혼 / 배우자있음 / 이혼 / 사별
    "military_status",  # 병역상태: 현역 / 비현역
    "family_type",      # 가족형태 (39종)
    "housing_type",     # 주거형태 (6종)
    "education_level",  # 학력 (7종)
    "bachelors_field",  # 전공계열 (11종)
    "province",         # 시도 (17종)
    "district",         # 시군구 (252종)
]

# 컬럼명 -> 한글 라벨 (엑셀 헤더 및 UI 표기용)
COLUMN_LABELS = {
    "uuid": "고유ID",
    "sex": "성별",
    "age": "나이",
    "marital_status": "혼인상태",
    "military_status": "병역상태",
    "family_type": "가족형태",
    "housing_type": "주거형태",
    "education_level": "학력",
    "bachelors_field": "전공계열",
    "occupation": "직업",
    "district": "시군구",
    "province": "시도",
    "country": "국가",
    "persona": "페르소나(요약)",
    "professional_persona": "직업 페르소나",
    "sports_persona": "스포츠 페르소나",
    "arts_persona": "예술 페르소나",
    "travel_persona": "여행 페르소나",
    "culinary_persona": "음식 페르소나",
    "family_persona": "가족 페르소나",
    "cultural_background": "문화적 배경",
    "skills_and_expertise": "기술 및 전문성",
    "skills_and_expertise_list": "기술 목록",
    "hobbies_and_interests": "취미 및 관심사",
    "hobbies_and_interests_list": "취미 목록",
    "career_goals_and_ambitions": "경력 목표",
}

ALL_COLUMNS = list(COLUMN_LABELS.keys())

# 구조화된(짧은) 컬럼만 - 메모리를 아끼고 싶을 때 사용
LIGHT_COLUMNS = [
    "uuid", "sex", "age", "marital_status", "military_status",
    "family_type", "housing_type", "education_level",
    "bachelors_field", "occupation", "district", "province", "persona",
]


def load_data(
    columns: Optional[Sequence[str]] = None,
    cache_dir: Optional[str] = None,
) -> pd.DataFrame:
    """
    Hugging Face에서 Nemotron-Personas-Korea 데이터셋을 내려받아
    pandas DataFrame으로 반환한다.

    - 첫 실행 시 약 2GB를 내려받으며, 이후에는 로컬 캐시를 사용한다.
    - columns 를 지정하면 해당 컬럼만 로드하여 메모리를 절약할 수 있다.
      (예: columns=LIGHT_COLUMNS)
    """
    try:
        from datasets import load_dataset
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "datasets 라이브러리가 필요합니다. 'pip install -r requirements.txt' 를 실행하세요."
        ) from exc

    ds = load_dataset(DATASET_ID, split="train", cache_dir=cache_dir)

    if columns:
        keep = [c for c in columns if c in ds.column_names]
        ds = ds.select_columns(keep)

    return ds.to_pandas()


def apply_filters(
    df: pd.DataFrame,
    *,
    sex: Optional[Iterable[str]] = None,
    age_min: Optional[int] = None,
    age_max: Optional[int] = None,
    marital_status: Optional[Iterable[str]] = None,
    military_status: Optional[Iterable[str]] = None,
    family_type: Optional[Iterable[str]] = None,
    family_type_contains: Optional[str] = None,
    housing_type: Optional[Iterable[str]] = None,
    education_level: Optional[Iterable[str]] = None,
    bachelors_field: Optional[Iterable[str]] = None,
    occupation_in: Optional[Iterable[str]] = None,
    occupation_contains: Optional[str] = None,
    province: Optional[Iterable[str]] = None,
    district: Optional[Iterable[str]] = None,
    max_results: Optional[int] = 1000,
    sample: bool = False,
    random_state: int = 42,
) -> pd.DataFrame:
    """
    주어진 조건으로 DataFrame을 필터링한다. 지정하지 않은(None/빈 값) 조건은 무시한다.

    - age_min / age_max : 나이 범위 (포함)
    - *_contains 인자     : 부분 문자열 포함 검색 (예: occupation_contains="교사")
    - occupation_in       : 직업 완전일치 목록
    - max_results         : 최대 반환 인원 (기본 1000명 이내)
    - sample=True         : 1000명 초과 시 무작위 표본 추출 (기본은 앞에서부터 자름)
    """
    mask = pd.Series(True, index=df.index)

    def add_isin(col: str, values: Optional[Iterable[str]]) -> None:
        nonlocal mask
        values = [v for v in (values or []) if v not in (None, "")]
        if values:
            mask &= df[col].isin(values)

    add_isin("sex", sex)
    add_isin("marital_status", marital_status)
    add_isin("military_status", military_status)
    add_isin("family_type", family_type)
    add_isin("housing_type", housing_type)
    add_isin("education_level", education_level)
    add_isin("bachelors_field", bachelors_field)
    add_isin("province", province)
    add_isin("district", district)
    add_isin("occupation", occupation_in)

    if age_min is not None:
        mask &= df["age"] >= int(age_min)
    if age_max is not None:
        mask &= df["age"] <= int(age_max)

    if occupation_contains:
        mask &= df["occupation"].str.contains(occupation_contains, case=False, na=False)
    if family_type_contains:
        mask &= df["family_type"].str.contains(family_type_contains, na=False)

    result = df[mask]

    if max_results is not None and len(result) > max_results:
        if sample:
            result = result.sample(n=max_results, random_state=random_state)
        else:
            result = result.head(max_results)

    return result.reset_index(drop=True)


def to_excel(
    df: pd.DataFrame,
    path: str,
    columns: Optional[Sequence[str]] = None,
    korean_headers: bool = True,
) -> str:
    """
    결과 DataFrame을 엑셀(.xlsx)로 저장한다.

    - columns        : 저장할 컬럼 순서/목록 (None이면 전체)
    - korean_headers : True면 헤더를 한글 라벨로 변경
    """
    out = df if columns is None else df[[c for c in columns if c in df.columns]]
    if korean_headers:
        out = out.rename(columns=COLUMN_LABELS)

    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        out.to_excel(writer, index=False, sheet_name="personas")
        # 컬럼 너비 자동 조정 (너무 길면 60자 제한)
        worksheet = writer.sheets["personas"]
        for idx, col in enumerate(out.columns, start=1):
            max_len = max(
                [len(str(col))]
                + [len(str(v)) for v in out[col].head(200).tolist()]
            )
            worksheet.column_dimensions[
                worksheet.cell(row=1, column=idx).column_letter
            ].width = min(max_len + 2, 60)

    return path
