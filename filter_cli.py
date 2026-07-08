"""
filter_cli.py
-------------
명령줄에서 조건을 인자로 주어 페르소나를 추출하고 엑셀로 저장하는 스크립트.
웹 UI 없이 재현 가능한 방식으로 돌리고 싶을 때 사용합니다.

예시:
    # 30~40세 남자, 미혼, 직업에 '개발' 포함, 최대 500명, 무작위 추출
    python filter_cli.py --sex 남자 --age-min 30 --age-max 40 \
        --marital 미혼 --occupation-contains 개발 \
        --max 500 --sample -o dev_men.xlsx

    # 서울 거주, 4년제 대학교 졸업, 전체(1000명 이내)
    python filter_cli.py --province 서울 --education 4년제 대학교 -o seoul.xlsx
"""

from __future__ import annotations

import argparse

import persona_filter as pf


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Nemotron-Personas-Korea 특성 필터 & 엑셀 추출기",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--sex", nargs="*", help="성별 (예: 남자 여자)")
    p.add_argument("--age-min", type=int, help="최소 나이")
    p.add_argument("--age-max", type=int, help="최대 나이")
    p.add_argument("--marital", nargs="*", help="혼인상태 (미혼 배우자있음 이혼 사별)")
    p.add_argument("--military", nargs="*", help="병역상태 (현역 비현역)")
    p.add_argument("--family", nargs="*", help="가족형태 (완전일치)")
    p.add_argument("--family-contains", help="가족형태 부분검색 (예: 자녀)")
    p.add_argument("--housing", nargs="*", help="주거형태")
    p.add_argument("--education", nargs="*", help="학력")
    p.add_argument("--field", nargs="*", help="전공계열")
    p.add_argument("--occupation", nargs="*", help="직업 (완전일치)")
    p.add_argument("--occupation-contains", help="직업 부분검색 (예: 교사)")
    p.add_argument("--province", nargs="*", help="시도 (예: 서울 경기)")
    p.add_argument("--district", nargs="*", help="시군구 (예: 서울-서초구)")
    p.add_argument("--max", type=int, default=1000, help="최대 추출 인원 (1000 이내)")
    p.add_argument("--sample", action="store_true", help="상한 초과 시 무작위 표본 추출")
    p.add_argument("--light", action="store_true",
                   help="구조화 컬럼만 로드하여 메모리 절약 (페르소나 상세 텍스트 제외)")
    p.add_argument("-o", "--output", default="personas.xlsx", help="저장할 엑셀 파일명")
    return p


def main() -> None:
    args = build_parser().parse_args()

    max_results = min(args.max, 1000)  # 안전하게 1000 이내로 제한

    print("데이터셋을 불러오는 중입니다... (최초 실행 시 약 2GB 다운로드)")
    df = pf.load_data(columns=pf.LIGHT_COLUMNS if args.light else None)
    print(f"로드 완료 — 총 {len(df):,}건")

    result = pf.apply_filters(
        df,
        sex=args.sex,
        age_min=args.age_min,
        age_max=args.age_max,
        marital_status=args.marital,
        military_status=args.military,
        family_type=args.family,
        family_type_contains=args.family_contains,
        housing_type=args.housing,
        education_level=args.education,
        bachelors_field=args.field,
        occupation_in=args.occupation,
        occupation_contains=args.occupation_contains,
        province=args.province,
        district=args.district,
        max_results=max_results,
        sample=args.sample,
    )

    if result.empty:
        print("조건에 맞는 사람이 없습니다. 조건을 완화해 보세요.")
        return

    pf.to_excel(result, args.output)
    print(f"✅ {len(result):,}명을 '{args.output}' 에 저장했습니다.")


if __name__ == "__main__":
    main()
