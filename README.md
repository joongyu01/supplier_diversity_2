# Supplier Diversity · 공공구매 물품 조사

인증 변경 공고는 [공고 모니터 화면](https://joongyu01.github.io/supplier_diversity_2/cancellations.html)에서 확인합니다.
GitHub Actions가 매일 한국시간 08:23에 고용노동부 관서의 인증취소·반납 관련 공고를 수집합니다.
범위·실행 방법·판정 한계는 [운영 문서](docs/cancellation-monitor.md)를 참고하세요.

사회적기업, 장애인기업, 여성기업, 중소기업, 중증장애인생산품 생산시설의 **나라장터 등록 공급물품**을 조사하는 프로젝트입니다.

- 웹사이트: https://joongyu01.github.io/supplier_diversity_2/
- 데이터 출처: [조달청 나라장터 사용자정보 서비스](https://www.data.go.kr/data/15129466/openapi.do)
- 화면: 물품·업체 검색, 기업 유형·지역 필터, 조회 결과 CSV 다운로드, 인증 근거 링크
- 초기 상태: **실제 API 데이터 수집 전**. 예시 업체나 문서의 샘플 응답을 실제 조사 결과로 게시하지 않습니다.

## 조사 범위

요청한 유형을 각각 별도 분류로 관리합니다. 모든 유형을 사회적기업으로 자동 간주하지 않습니다. 사용자가 말한 ‘중증장애인기업’의 조사 분류는 우선 ‘중증장애인생산품 생산시설’로 두었으며, 이후 대상 범위를 확정해 확장할 수 있습니다.

이 API의 확인된 기본정보 항목만으로는 요청한 기업 유형별 인증을 판정할 수 없습니다. **별도 인증 근거가 있는 조사 대상 목록 → 사업자등록번호로 API 연결 → 등록 공급물품 탐색** 순서입니다. 등록 물품은 실제 상품명·판매 중 여부·가격·재고·우선구매 실적 인정 여부를 보증하지 않습니다. 구매 전에 인증서 및 판매 여부를 확인해야 합니다.

## 시작하기

1. 공공데이터포털에서 위 서비스를 활용신청하고 인증키를 발급받습니다.
2. 저장소 **Settings → Secrets and variables → Actions → New repository secret**에 `DATA_GO_KR_SERVICE_KEY`를 등록합니다. 인증키는 소스·설정 JSON·웹 화면에 넣지 않습니다.
3. `config/suppliers.json`에 실제 조사 대상과 유형별 근거를 등록합니다. 아래는 형식 설명용이며 실제 기업이 아닙니다. 확인일은 근거를 실제 확인한 날짜로 입력합니다.

```json
[
  {
    "bizno": "0000000000",
    "name": "실제 조사 대상 업체명으로 교체",
    "evidence": [
      {
        "category": "여성기업",
        "url": "https://example.org/실제-인증-근거로-교체",
        "checkedAt": "2026-09-09",
        "validUntil": ""
      }
    ]
  }
]
```

여러 유형이면 evidence에 각각 추가합니다. 유형 허용값은 `사회적기업`, `장애인기업`, `여성기업`, `중소기업`, `중증장애인생산품 생산시설`입니다. URL·확인일은 필수이며 만료일 미등록은 유효 인증을 보증하지 않습니다. 만료일이 지난 근거가 있으면 수집을 중단합니다. 공개 저장소이므로 공개해도 되는 근거와 업체 정보만 등록하세요.

4. **Actions → Collect procurement data → Run workflow**를 실행합니다. 성공한 전체 수집 결과만 저장·게시합니다. 수집 실패 시 이전 결과가 유지됩니다.
5. 웹사이트에서 수집일·업체 수와 등록 공급물품을 확인합니다.

수집은 수동 실행입니다. 주기·호출량을 확정한 뒤 정기 수집을 추가할 수 있습니다. 기본 배포는 main push마다 실행됩니다. 수집 workflow는 GitHub 토큰의 연쇄 workflow 제한을 피하도록 수집 후 직접 Pages를 배포합니다.

## 로컬 실행

Python 3.10 이상, 별도 Python 패키지 설치 불필요.

```powershell
python -m http.server 8000 --directory site
```

브라우저에서 http://localhost:8000 접속. 파일을 직접 더블클릭하면 JSON fetch가 제한될 수 있습니다.

로컬 수집은 `DATA_GO_KR_SERVICE_KEY` 환경변수를 설정한 상태에서 `python scripts/collect.py`를 실행합니다. 공개 로그에 인증키나 전체 요청 URL을 출력하지 않습니다.

```powershell
python -m unittest discover -s tests -v
node --check site/app.js
```

## 구조

```text
site/                   GitHub Pages에 게시되는 정적 웹사이트
site/data/catalog.json  API 수집 결과 (공개 필드만 저장)
config/suppliers.json   인증 근거가 있는 조사 대상 목록
scripts/collect.py      업체 기본정보·공급물품 수집 및 결합
tests/                  오류·페이지 누락·업체 식별자·결합 검증
.github/workflows/      Pages 배포 / 수동 API 수집
docs/api-notes.md       확인된 명세와 한계
```

브라우저에는 인증키가 전달되지 않습니다. Actions가 API를 호출하고 정적 JSON을 생성하므로 Pages의 서버 부재와 브라우저 CORS 제약을 피합니다. 공개 결과는 업체명·사업자등록번호·지역·기업 유형 근거·물품 정보로 제한하며 대표자명·상세주소·연락처는 저장하지 않습니다.

