# 시스템 에이전트 작업 폴더

Herdr Office가 시스템 에이전트(경영지원팀·대표·상인회)를 만들 때 이 설정을 작업 폴더의
`.claude/settings.json`으로 복사합니다.

- `dontAsk` 모드: 허용 목록에 없는 동작은 묻지 않고 거부합니다.
- 허용: `herdr-office ...` 명령, 작업 폴더 안 파일 수정. 작업 폴더 안 읽기는 기본 허용입니다.
- 거부: 웹 접근, 하위 에이전트 실행. 그 밖의 셸 명령과 작업 폴더 밖 접근은 `dontAsk`가 거부합니다.

에이전트는 템플릿의 `command`로 실행되며 `--setting-sources project`로 사용자 전역 설정의
허용 규칙을, `--strict-mcp-config`로 사용자 MCP 서버를 가져오지 않습니다.
