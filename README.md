# Herdr Office

Herdr에서 돌리는 AI 에이전트 팀들을 **하나의 회사**로 보여주는 셀프호스트 웹 서비스입니다.
Space는 부서, 에이전트는 직원, 장비는 건물이 됩니다. 직원들은 실제 상태에 따라 일하고, 쉬고, 대화하고,
출퇴근합니다. 창밖은 회사 위치의 **실제 시간과 날씨**를 따릅니다.

> English: a self-hosted web app that turns your Herdr agent teams into a living 3D low-poly company —
> spaces become departments, agents become employees, machines become buildings, with real-world time
> and weather outside the windows.

## 주요 기능 (v0.1)

- **실시간 조직도**: Herdr Space와 터미널을 실시간으로 읽어 부서·직원을 만듭니다. 팀이 새로 생기면 사무실이
  증축되고, 팀이 없어지면 불이 꺼집니다.
  - 폴더 위계: 한 팀의 작업 폴더가 다른 팀 폴더 아래에 있으면 하위 부서가 됩니다. 상위 팀이 실제로
    관리하지 않으면(메시지·부모 관계가 없으면) 독립 부서로 둘 수 있습니다.
  - 그룹: 여러 팀을 부서장 없는 부서로 묶습니다.
  - 장비끼리는 수평 관계입니다. 장비마다 **건물 이름**과 **공간 종류**(사무실·서버실·연구소·스튜디오)를
    정할 수 있고, 같은 건물 이름이면 한 건물 안의 방으로, 다르면 별도 지점으로 그립니다.
- **살아 있는 직원**: 작업 중이면 타이핑, 막히면 손을 들고, 쉴 때는 매번 다른 휴식(커피·편의점·산책·낮잠 등)을
  합니다. 근무시간·공휴일(한국)·재택(퇴근 후 일이 생기면 중요도에 따라)·야근을 반영해 출퇴근합니다.
- **사용량 소진 연출**: 에이전트 구독 사용량이 바닥나면 리셋까지 남은 시간에 따라 쪽잠·수면·조기퇴근·연차로
  자리를 비웁니다.
- **사람 말투 말풍선**: 에이전트끼리의 메시지 원문 대신 사람이 말하듯 바꿔 보여줍니다.
- **동네**: 회사 주변 도로·가게·공원·주거지와 행인·차량, 실제 해 위치와 날씨(비·눈·안개·번개).
- **공개 링크**: 외부 방문자는 읽기 전용이며, 작업 경로·작업 제목·메시지 내용은 보이지 않습니다.

## 요구 사항

- Node.js 22.12 이상 (24 권장)
- Herdr와 `hc` CLI가 같은 장비에 설치되어 실행 중이어야 합니다.
  다른 장비의 팀은 `hc machine add`로 연결하면 함께 표시됩니다.

## 설치와 실행

```sh
git clone https://github.com/Eht3r/herdr-office.git
cd herdr-office
npm ci
npm start            # 웹을 빌드하고 http://127.0.0.1:3000 에서 실행
```

개발 모드(핫 리로드): `npm run dev` → 웹 http://127.0.0.1:5173

## 설정 (환경 변수)

| 변수                                   | 기본값                       | 설명                                                                      |
| -------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `OFFICE_PORT`                          | `3000`                       | 서버 포트                                                                 |
| `OFFICE_HOST`                          | `127.0.0.1`                  | 바인딩 주소. 기본은 이 장비에서만 접속 가능                               |
| `OFFICE_DB`                            | `.office-data/office.sqlite` | 설정·시뮬레이션 저장 파일                                                 |
| `OFFICE_LATITUDE` / `OFFICE_LONGITUDE` | 서울                         | 회사 위치(날씨·해 위치 기준)                                              |
| `OFFICE_TIME_ZONE`                     | `Asia/Seoul`                 | 회사 시간대                                                               |
| `OFFICE_COUNTRY`                       | `KR`                         | 공휴일 국가(현재 한국만 지원, 그 외는 주말만 휴일)                        |
| `OFFICE_WORK_HOURS_ENABLED`            | `true`                       | 근무시간 모드(퇴근·출근 연출)                                             |
| `OFFICE_COMPANY_HOURS`                 | 평일 09–18                   | 요일별 근무시간 JSON, 예: `{"1":[540,1080],"6":null}` (분 단위, 0=일요일) |
| `OFFICE_TEAM_HOURS`                    | –                            | 팀별 근무시간 JSON `{"<space id>": {...}}`                                |
| `OFFICE_LEARN_HOURS`                   | `false`                      | 최근 활동으로 근무시간 자동 학습                                          |
| `OFFICE_REMOTE_WORK`                   | `afterHours`                 | `none`이면 퇴근 후에도 재택 없이 출근                                     |
| `OFFICE_SPEECH_EXPOSURE`               | `status`                     | 말풍선 노출: `status` / `title` / `messages` / `raw`                      |
| `OFFICE_ABSENCE_NAP_MINUTES` 등        | 30 / 300 / 1440              | 소진 시 쪽잠·수면·조기퇴근 경계(분)                                       |
| `OFFICE_TRUSTED_NETWORKS`              | –                            | 소유자로 볼 네트워크 CIDR, 예: `100.64.0.0/10`                            |
| `OFFICE_ALLOWED_HOSTS`                 | –                            | 접속을 허용할 추가 호스트 이름                                            |
| `OFFICE_PUBLIC_HOSTS`                  | –                            | 항상 읽기 전용으로 볼 공개 도메인                                         |

## 접근과 공개

로그인이 없습니다. 대신 **누가 접속했는지**로 권한을 나눕니다.

- 이 장비(`127.0.0.1`)나 `OFFICE_TRUSTED_NETWORKS`에서 온 접속은 **소유자**입니다. 건물·그룹 설정을 바꿀 수 있습니다.
- 그 밖의 접속과, 리버스 프록시·터널을 거쳐 들어온 접속(`X-Forwarded-For`/`Forwarded` 헤더)은 **공개 방문자**입니다.
  보기만 할 수 있고 작업 경로·작업 제목·메시지·사용률은 보이지 않습니다.
- 등록되지 않은 Host 헤더(DNS 리바인딩), 다른 사이트에서 보낸 쓰기 요청은 거부합니다.

외부에 공개하려면 터널이나 리버스 프록시로 내보내고 그 도메인을 `OFFICE_PUBLIC_HOSTS`에 넣으세요.

## 시스템 에이전트 템플릿

`templates/`에 회사 운영용 에이전트 템플릿(경영지원팀·대표·상인회)과, 이 에이전트들이 이 프로젝트의 작업
폴더 안에서 `herdr-office` 명령만 쓰도록 묶는 권한 설정(`templates/sandbox/`)이 들어 있습니다.
생성 기능과 `herdr-office` 명령은 다음 버전에서 제공합니다.

## 개발

```sh
npm run check   # Biome + TypeScript
npm test        # Vitest
npm run build
```

구조: `packages/core`(조직 계산·파서·말투·동네 생성), `apps/server`(Herdr 연결·시뮬레이션·API),
`apps/web`(React Three Fiber 화면).

## 라이선스

MIT
