# 한국인 페르소나 추출기 (Nemotron-Personas-Korea Filter)

NVIDIA의 **[Nemotron-Personas-Korea](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea)** 데이터셋(한국 통계에 기반해 합성된 한국인 페르소나 100만 건)에 연결해서, **원하는 특성(직업·나이대·가족형태·지역 등)을 골라 최대 1,000명을 추출한 뒤 엑셀(.xlsx)로 저장**하는 프로그램입니다.

> 이 데이터셋은 실제 개인정보가 아닌 통계 기반 합성 데이터이며 CC BY 4.0 라이선스로 상업·비상업 모두 자유롭게 사용할 수 있습니다.

## 선택할 수 있는 특성

| 특성 | 예시 값 |
|------|---------|
| 성별 | 남자, 여자 |
| 나이대 | 19 ~ 99 (범위 지정) |
| 혼인상태 | 미혼, 배우자있음, 이혼, 사별 |
| 병역상태 | 현역, 비현역 |
| 가족형태 | 혼자 거주, 배우자·자녀와 거주 등 (39종) |
| 주거형태 | 아파트, 다세대주택 등 |
| 학력 | 초등학교 ~ 대학원 (7종) |
| 전공계열 | 공학·제조·건설, 보건·복지 등 (11종) |
| 직업 | 부분검색(예: "교사") 또는 직접 선택 |
| 지역 | 시도(17종) / 시군구(252종) |

## 설치

Python 3.9 이상이 필요합니다.

```bash
git clone <이 저장소 주소>
cd nemotron-personas-korea-filter

pip install -r requirements.txt
```

## 실행 방법 1 — 웹 화면에서 클릭으로 선택 (권장)

```bash
streamlit run app.py
```

브라우저가 열리면 왼쪽 사이드바에서 특성을 고르고, 아래쪽 **📥 엑셀 다운로드** 버튼으로 저장하면 됩니다.

- 조건에 맞는 전체 인원과 실제 추출 인원이 함께 표시됩니다.
- 1,000명을 넘으면 무작위 표본(기본) 또는 앞에서부터 추출하도록 선택할 수 있습니다.
- 엑셀에 담을 항목(컬럼)도 직접 고를 수 있습니다.

## 실행 방법 2 — 명령줄에서 실행

```bash
# 30~40세 남자, 미혼, 직업에 '개발' 포함, 최대 500명 무작위 추출
python filter_cli.py --sex 남자 --age-min 30 --age-max 40 \
    --marital 미혼 --occupation-contains 개발 \
    --max 500 --sample -o dev_men.xlsx

# 서울 거주, 4년제 대학교 졸업 (1000명 이내)
python filter_cli.py --province 서울 --education "4년제 대학교" -o seoul.xlsx

# 가족형태에 '자녀'가 포함된 사람
python filter_cli.py --family-contains 자녀 -o with_children.xlsx
```

전체 옵션은 `python filter_cli.py --help` 로 확인하세요.

## 참고 사항

- **최초 실행 시** Hugging Face에서 데이터셋(약 2GB)을 한 번 내려받습니다. 이후에는 로컬 캐시를 사용해 빠르게 실행됩니다. (인터넷 연결 필요)
- 전체 컬럼을 메모리에 올리면 약 3~4GB의 RAM을 사용합니다. 메모리가 부족하면:
  - CLI: `--light` 옵션을 사용하세요 (상세 페르소나 텍스트 제외, 구조화 항목만).
  - 웹앱: `app.py` 상단의 `LOAD_COLUMNS = None` 을 `LOAD_COLUMNS = pf.LIGHT_COLUMNS` 로 바꾸세요.
- 결과 엑셀 헤더는 한글 라벨로 저장됩니다.

## 파일 구성

```
persona_filter.py   # 데이터 로드·필터링·엑셀 저장 핵심 로직
app.py              # Streamlit 웹 앱 (클릭 선택 UI)
filter_cli.py       # 명령줄 버전
requirements.txt    # 의존성
```

## 데이터 출처 / 인용

NVIDIA, *Nemotron-Personas-Korea: Synthetic Personas Aligned to Real-World Distributions for Korea* (2026).
데이터셋: https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea (CC BY 4.0)
