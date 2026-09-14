# DAAT 전체 감사 및 개선 제안

감사일: 2026-09-14 · 대상: 현재 작업 폴더의 DAAT macOS 앱 · 패키지 버전: 0.17.0 · 기준 HEAD: `a19c4f6a8`

이 보고서는 배포된 바이너리나 원격 main의 판정이 아니라, **기존 미커밋·신규 파일을 포함한 현재 작업 파일**을 대상으로 한 감사다. 제품 코드는 수정하지 않았다. 발견 사항 34개 중 21개는 격리된 실제 모듈 실행으로 재현했고, 13개는 구현과 호출 경로를 확인했다. 별도로 실제 계정·서명된 설치 파일·운영 환경이 필요한 미검증 항목을 남겼다.

## 1. 판단

DAAT는 **사용자의 Markdown 노트를 중심에 두고 AI가 읽기·정리·실행을 돕는 개인 작업 앱**이다. 노트 편집뿐 아니라 할 일, 달력, 메일, 가계부, 회의 녹음과 자동 기억이 같은 보관함을 중심으로 연결된다. 제품의 가장 큰 장점은 사용자가 파일을 직접 소유하면서 여러 작업의 맥락을 공유할 수 있다는 점이다.

현재 단계에서 효과가 가장 큰 작업은 **데이터 보존, 실패 시 복구, 정확한 작업 대상 지정**이다. 같은 파일을 편집기·AI·동기화·녹음 기능이 각각 다루지만 저장 규칙과 파일 소유권이 일치하지 않는 곳이 있다. 화면을 넓히기 전에 이 공통 약점을 해결하면 여러 기능이 동시에 안정된다.

특히 이름 변경 덮어쓰기, 보관함 전환 중 잘못된 위치에 저장, 저장 충돌 시 추가 입력 소실, 일정 서버 장애 후 삭제, 반복 업데이트 후 사용자 파일 삭제는 우선 수정할 근거가 충분하다. 자동 기억의 긴 파일 잘림과 메일 승인 대상 충돌도 재현했다.

검증 결과는 양면적이다. 데스크톱 자동 시험 **3,783개**, 타입 검사와 빌드는 통과했고 기본 화면·실제 편집 저장도 작동했다. 그러나 이러한 통과가 저장 중 외부 변경, 계정 전환, 네트워크 장애, 연속 업데이트까지 안전하다는 뜻은 아니다. 이번 결함은 주로 그 경계에서 나왔다.

## 2. 제품과 구조 이해

| 층 | 현재 역할 | 감사에서 중요하게 본 점 |
| --- | --- | --- |
| Markdown 보관함 | 사용자 문서·속성·할 일·일정·회의 결과의 원본 | 파일 보존, 외부 편집, iCloud 대기, 링크·이름 변경 |
| Electron 메인 프로세스 | 파일 접근, 색인, 캘린더 동기화, 메일 연결, 설치·업데이트 | 실제 파일 경계, 원자적 처리, 실패 복구 |
| React·CodeMirror·nanostores 화면 | 노트 편집과 Home/Todo/Calendar/Mail/Money/Meetings/Graph | 공유 상태, 비동기 결과의 대상, 입력·오류 안내 |
| SQLite·FTS | 노트 검색·관계 등 다시 만들 수 있는 파생 정보 | 원본과 구분, 증분 갱신, 대규모 노트 |
| Python Hermes 런타임과 플러그인 | 모델 실행, 노트 도구, 메일, 회의 전사, 기억 | 도구 승인, 설정 전달, 여러 쓰기 경로의 충돌 |
| DAAT Cat | 별도 Swift 보조 앱, 작업·사용량 표시 | 실행 수명, 동일 프로필, 인증 책임 |

근거가 되는 진입점: [앱 화면 구성](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/notes-shell.tsx:1>) · [보관함 서비스](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-service.ts:1>) · [AI 노트 도구](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/plugins/vault/tools.py:1>) · [자동 기억](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/plugins/memory/vault/__init__.py:1>) · [앱과 백엔드 실행](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/main.ts:1>).

유지할 설계도 있다.

- Markdown 원본과 재생성 가능한 색인을 분리한 구조는 파일 소유와 복구에 유리하다.
- 편집기의 충돌 사본, iCloud 미다운로드 보호, Python의 임시 파일 후 교체, 녹음 청크 저장 등 보호 장치가 이미 있다. 이 장치를 공통 경로와 경계 상황까지 확장하는 것이 적절하다.
- 기능이 노트·메일·회의 플러그인에 놓인 방향은 기반 Hermes의 좁은 코어 원칙과 맞는다. 새로운 기능을 위해 코어 모델 도구를 계속 늘릴 필요는 없다.
- 보관함 맥락을 새 사용자 턴에 넣고 이전 API 내용을 재사용하는 경로를 확인했다. 이를 곧바로 시스템 프롬프트 캐시 파괴로 판정하지 않았다.
- 현재 메일 인수의 `--` 경계, 헤더 줄바꿈 방어, 프로덕션 CSP가 존재한다. “메일 인수 방어 없음”, “CSP 없음”은 이번 발견 사항이 아니다.

## 3. 감사 범위와 검증 결과

### 수행 범위

제품 문서, 첫 실행, 노트 저장·편집·이름 변경·검색·속성·보관함 전환, Todo, Calendar/ICS, Mail, Money, Meetings, AI 맥락·기억·승인, Cat, 설치·업데이트, 빌드·시험 경로를 살폈다. 기반 Hermes 전체의 모든 플랫폼·공급자·모델 조합을 전수 감사한 것은 아니다.

재현은 임시 보관함과 격리 앱 데이터에서 수행했다. 필요할 때 HTTP, 메일 최종 전송, 녹음 입력, 모델 실행을 대체했다. 실제 메일 발송·이동, OAuth 토큰 갱신, 마이크 녹음, 외부 LLM 요청, 실제 설치 폴더 업데이트를 수행하지 않았다. UI 시험에서는 보조 Cat 실행과 실제 메일 바이너리 접근도 차단했다.

| 검증 | 결과 | 해석과 한계 |
| --- | --- | --- |
| 데스크톱 전체 Vitest | 413개 파일 통과, 1개 파일 건너뜀 / 3,783개 시험 통과, 2개 건너뜀 | 기존 회귀 시험은 양호하나 이번 비동기·실패 조합을 모두 포함하지 않음 |
| 데스크톱 타입 검사 | 통과 | renderer·Electron·E2E 타입 검사 |
| 데스크톱 빌드 | 통과 | 로컬 빌드 성공. 서명·공증·깨끗한 Mac 설치 성공을 뜻하지 않음 |
| 관련 Python 플러그인 시험 5개 파일 | **73 통과, 2 실패** | vault recall/filing, 도구 인수, Money, 메일 답장 범위 |
| 격리 Electron 기본 화면 | 통과 | Home·Notes·Todo·Calendar·Money·Meetings·Mail, 까다로운 frontmatter 문서 렌더링, 기본 오류 확인 |
| 격리 Electron 실제 편집 | 통과 | TYPED 입력이 실제 임시 Markdown 파일에 저장됨 |
| 격리 Electron 온보딩 | **완주 실패** | 페르소나·폴더 단계는 통과. fake backend 조건의 다음 단계에서 textarea 대기 시간 초과. 실제 최초 설치 고장으로 단정하지 않음 |
| 노트 1만 개 규모 | 실행 완료 | 실제 색인 완료 확인 후 목록·표·그래프 관찰. 아래 별도 설명 |
| 추가 결함 재현 | 21개 발견 사항에 재현 근거 | 실제 모듈/임시 파일 실행이며 모두 전체 앱 E2E인 것은 아님 |

Python 실패 이름은 `test_mail_positionals_are_terminated`, `test_mail_search_keeps_quoted_phrases_together`다. 테스트는 공격 모양 문자열을 여러 argv 원소로, 따옴표 구문을 분리된 원소로 기대한다. 현재 구현은 `--` 뒤에 값 전체를 두고 검색 식의 따옴표를 보존한다. 따라서 **이 두 실패만으로 인수 주입 방어가 깨졌다고 볼 수 없다.** 실제 Himalaya가 다시 합쳐 해석하는 구문과 일치하는 계약 검증으로 시험을 갱신할 필요가 있다. 실제 CLI·메일 서버 조합 검증은 남아 있다.

주요 재실행 경로:

```text
apps/desktop: ../../node_modules/.bin/vitest run
apps/desktop: npm run typecheck
apps/desktop: npm run build
저장소 루트:
scripts/run_tests.sh -j 2 tests/plugins/test_vault_recall.py tests/plugins/test_vault_filing.py tests/plugins/test_daat_tool_injection.py tests/plugins/test_money.py tests/plugins/test_mail_reply.py -q
```

기존 UI probe는 감사용 임시 복사본에서 경로와 격리 설정을 바꿔 실행했다. 저장소의 probe 파일을 수정한 것은 아니다. 감사 증거 폴더의 로그·JSON은 이번 결과 기록이며, 제품 회귀 시험에 아직 편입하지 않았다.

### 규모 시험의 구체적인 의미

10,000개 합성 노트 생성 후 색인 수 **10,003개**, `indexing:false`를 확인했다. 앱이 추가로 만든 노트도 포함된 수치다.

| 관찰 | 이번 실행 결과 | 판단 |
| --- | --- | --- |
| 사이드바 | 버튼 78개, 전체 DOM 446개 | 모든 노트를 화면 요소로 만들지 않는 구조가 작동함 |
| 스크롤 12단계 | 약 85ms | 자동화 조작 묶음 시간. 사람 체감 입력 지연의 정밀 측정은 아님 |
| 표 화면 열기 | 약 212ms, 렌더링 행 36개 | 전체 노트 수에 비해 렌더링 범위가 제한됨 |
| 전체 그래프 | 10,003 노드, 19,997 링크, 시뮬레이션 중 약 36fps | 큰 전체 그래프는 로컬 그래프·필터·정지 기능 개선 가치가 있음 |
| 검색 | 약 1,517ms 기록 | **고정 1,500ms 대기 포함**이므로 순수 검색 지연으로 사용 불가 |
| 그래프 열기·안정화 | 약 6,160ms 기록 | **고정 6,000ms 대기 포함**이므로 순수 로딩 지연으로 사용 불가 |
| 시작·색인 대기 | 약 20,131ms 기록 | 고정 대기를 포함. 콜드 스타트나 정확한 색인 처리량을 뜻하지 않음 |

단일 로컬 Mac·합성 데이터·fake backend 조건이며 p50/p95, 장시간 메모리, 배터리, 실제 iCloud·대형 첨부 파일은 측정하지 않았다. 현재 근거로 “성능이 전반적으로 나쁘다”거나 “1만 개에서도 모든 기능이 안전하다”고 결론 내리지 않는다.

## 4. 우선순위와 근거 읽는 법

- **P1: 해당 기능의 사용·배포를 확대하기 전에 우선 해결.** 데이터 소실·잘못된 대상 변경·승인 범위·실행 불능 위험.
- **P2: 안정화 단계에서 보완.** 누락·정확성·실패 안내·접근성·연동 일관성.
- **P3: 유지보수 개선.** 문서와 현재 제품의 정합성.
- **R:** 격리된 실제 모듈 호출로 증상을 재현. 외부 의존성을 대체한 경우 상세에 기재.
- **C:** 코드와 호출 경로를 확인. 실제 사용자 환경에서 증상까지 입증한 것은 아님.
- **규모 S/M/L:** 수정 범위가 작음 / 여러 경로의 조정 / 업데이트 등 수명주기 재설계. 일정 약속이 아닌 상대적 규모다.

P1 16개 · P2 17개 · P3 1개. 서로 같은 근본 원인을 공유하는 항목이 있으므로 34개의 별도 프로젝트로 만들 필요는 없다. 아래의 작업 묶음으로 함께 해결하는 편이 효율적이다.

| ID | 우선순위 | 근거 | 영역 | 발견 사항 | 규모 |
| --- | --- | --- | --- | --- | --- |
| F01 | P1 | R | 노트 저장 | 보관함 전환 중 미저장 내용이 새 보관함에 기록됨 | M |
| F02 | P1 | R | 노트 파일 | 이름 변경이 같은 이름의 기존 노트를 덮어씀 | S |
| F03 | P1 | R | 노트 저장 | 충돌 처리 도중 새로 입력한 글자가 사라짐 | M |
| F04 | P1 | C | 노트 복구 | 미저장 구조가 메모리에만 있어 종료·화면 재시작에 취약함 | M |
| F05 | P1 | R | 백업 | 한글 파일명과 같은 초의 쓰기가 백업 이름 충돌을 일으킴 | S |
| F06 | P1 | R | 파일 경계 | 심볼릭 링크를 통해 보관함 밖 파일을 읽거나 쓸 수 있음 | M |
| F07 | P1 | R | 업데이트 | 업데이트가 사용자가 추가한 파일까지 앱 소유로 취급함 | M |
| F08 | P1 | R | 업데이트 복구 | 업데이트 중 실패하면 새 버전과 이전 버전이 섞여 재시도도 막힘 | L |
| F09 | P1 | C | 업데이트 의존성 | Python 의존성이 바뀌어도 기존 실행 환경을 그대로 사용함 | M |
| F10 | P1 | R | 캘린더 동기화 | 캘린더 서버 오류가 기존 일정 삭제로 이어짐 | M |
| F11 | P1 | R | 캘린더 메모 | 동기화 일정에 사용자가 쓴 메모가 다음 동기화에서 사라짐 | M |
| F12 | P1 | R | 회의 녹음 | 같은 분·같은 제목의 녹음이 합쳐지고 취소가 이전 녹음도 제거함 | M |
| F13 | P1 | R | AI 자동 기억 | 긴 Inbox 노트에 자동 기억을 추가하면 기존 끝부분이 잘림 | M |
| F14 | P1 | R | 메일 승인 | 앞 400자가 같은 다른 메일 본문에 이전 승인이 재사용됨 | M |
| F15 | P1 | C | 메일 계정 전환 | 계정 전환 직후 이전 메시지 ID를 새 계정에 적용할 수 있음 | M |
| F16 | P1 | R | 일정 이동 | 노트 줄 순서가 바뀌면 다른 할 일의 날짜를 수정함 | M |
| F17 | P2 | C | 할 일 완전성 | 전체 Todo 화면이 최근 300개 노트·100개 항목 범위에 제한됨 | M |
| F18 | P2 | R | 일정 저장 피드백 | 일정 쓰기 실패를 성공으로 보고 입력을 지움 | S |
| F19 | P2 | C | 메일 AI | 요약·답장·노트 저장 요청에서 선택한 메일 계정이 빠짐 | S |
| F20 | P2 | R | 노트 속성 | 따옴표로 감싼 YAML 키를 수정하면 문서 속성이 깨짐 | S |
| F21 | P2 | R | 첫 사용 | 온보딩 파일 드롭이 파일을 읽지 않고 선호 설정에 경로를 저장함 | M |
| F22 | P2 | R | 음성 전사 | 요청한 한국어 전사 설정이 실제 전사 호출에서 빠짐 | M |
| F23 | P2 | R | AI 기억 활성화 | 노트 도구와 자동 기억이 서로 다른 보관함 설정을 읽음 | M |
| F24 | P2 | R | AI 기억 품질 | 긴 대화의 최신 결정이 자동 기억 후보에서 빠짐 | S |
| F25 | P2 | R | 캘린더 구독 | 마지막 구독을 해제하면 기존 동기화 일정이 그대로 남음 | S |
| F26 | P2 | R | 캘린더 정확성 | 반복 일정 예외·변경·시간대 지원이 불완전함 | M |
| F27 | P2 | C | 날짜 일관성 | 선택 날짜·로컬 날짜·UTC 날짜가 섞임 | S |
| F28 | P2 | C | 한국어 입력 | 일부 입력창이 한글 조합 중 Enter를 실행으로 처리할 수 있음 | S |
| F29 | P2 | C | 녹음 가시성 | 다른 화면으로 이동하면 녹음 상태와 중지 조작이 사라짐 | S |
| F30 | P2 | C | 상태·오류 안내 | 부분 집계·연결 실패·설정 실패가 정상 상태처럼 보임 | M |
| F31 | P2 | C | DAAT Cat | 보조 앱이 DAAT와 다른 기본 데이터 폴더를 읽음 | S |
| F32 | P2 | C | 배포 검증 | 기존 패키지 시험 도구가 이전 Hermes 앱 이름을 가정함 | S |
| F33 | P2 | C | 언어·접근성 | 한글 사용 경험과 키보드 접근이 화면마다 일관되지 않음 | M |
| F34 | P3 | C | 제품 문서 | 현재 DAAT와 README·설계·인수인계 문서의 설명이 어긋남 | S |

## 5. 발견 사항별 근거와 수정 기준

### F01 · P1 · 보관함 전환 중 미저장 내용이 새 보관함에 기록됨

- **영역 / 근거 / 규모:** 노트 저장 · R · M
- **문제와 영향:** chooseVault가 저장을 비우기 전에 vault.choose를 호출합니다. 해당 IPC가 이미 백엔드의 보관함 루트를 교체하므로, 이후 저장은 이전 파일 이름을 새 보관함에서 해석합니다.
- **확인한 결과:** 실제 저장 상태 모듈과 임시 파일 쓰기를 연결하고 IPC의 루트 전환 순서를 반영한 재현에서, 이전 보관함의 Private.md는 원본 그대로였고 새 보관함에 미저장 문장이 든 Private.md가 생겼습니다. 전체 GUI 전환 재현은 아닙니다.
- **수정 방향:** 폴더 선택과 보관함 활성화를 분리하고 이전 보관함 저장·복구 확보 후 전환합니다. 모든 쓰기에 보관함 식별자를 함께 전달합니다.
- **완료 조건:** 느린 저장·저장 실패·전환 취소·서로 같은 상대 경로가 있는 두 보관함에서도 내용이 다른 보관함으로 이동하지 않아야 합니다.
- **코드:** [store.ts:190](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/vault/store.ts:190>) · [vault-ipc.ts:108](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-ipc.ts:108>)

### F02 · P1 · 이름 변경이 같은 이름의 기존 노트를 덮어씀

- **영역 / 근거 / 규모:** 노트 파일 · R · S
- **문제와 영향:** 파일 이름 변경에 덮어쓰기를 허용하는 fsp.rename을 사용합니다. 화면의 오류 처리는 대상이 이미 있으면 예외가 발생할 것으로 기대합니다.
- **확인한 결과:** 임시 A.md를 이미 존재하는 B.md로 변경하자 B의 원래 내용이 A의 내용으로 교체되고 A는 사라졌습니다. 실제 서비스와 파일 시스템을 사용했습니다.
- **수정 방향:** 기존 대상을 교체하지 않는 이름 변경을 보장하고 충돌을 화면에 표시합니다. 대소문자만 바꾸는 경우와 외부 프로세스의 동시 생성을 별도로 처리합니다.
- **완료 조건:** 동일 이름·대소문자 충돌·외부 동시 생성 상황에서 원본과 대상 내용이 모두 보존되어야 합니다.
- **코드:** [vault-service.ts:641](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-service.ts:641>) · [sidebar.tsx:148](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/sidebar.tsx:148>)

### F03 · P1 · 충돌 처리 도중 새로 입력한 글자가 사라짐

- **영역 / 근거 / 규모:** 노트 저장 · R · M
- **문제와 영향:** 저장 성공 경로는 저장 도중의 추가 입력을 구분하지만, 충돌 경로는 외부 파일을 adoptNote로 받아들이며 최신 대기 입력까지 비웁니다.
- **확인한 결과:** 첫 저장을 지연시키고 추가 입력 후 충돌 응답을 반환했습니다. 충돌 사본에는 FIRST UNSAVED만 남고, 이후 추가한 PLUS LATEST KEYSTROKES는 활성 문서·복구 버퍼 어디에도 없었습니다.
- **수정 방향:** 저장 요청 당시 문장과 현재 편집 버퍼를 분리합니다. 충돌 시 최신 버퍼를 영속 복구본으로 보존하고 사용자가 비교·병합하도록 합니다.
- **완료 조건:** 외부 수정, 느린 저장, 추가 타이핑이 겹쳐도 모든 사용자 입력이 원본·충돌본·복구본 중 하나에 남아야 합니다.
- **코드:** [store.ts:405](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/vault/store.ts:405>) · [store.ts:214](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/vault/store.ts:214>)

### F04 · P1 · 미저장 구조가 메모리에만 있어 종료·화면 재시작에 취약함

- **영역 / 근거 / 규모:** 노트 복구 · C · M
- **문제와 영향:** 구조용 rescue가 메모리 Map이며 beforeunload는 완료를 기다리지 않습니다. UI 모드 전환은 저장 실패 여부와 관계없이 finally에서 화면을 재시작합니다.
- **확인한 결과:** 저장 실패 시 버퍼를 보존하는 코드와 무조건 재시작하는 호출 경로를 확인했습니다. 실제 강제 종료·디스크 부족 상황의 전체 앱 재현은 하지 않았습니다.
- **수정 방향:** 앱 데이터 폴더에 보관함·파일·버전별 복구 저널을 기록하고 다음 실행에서 복원을 안내합니다. 정상 닫기·모드 전환은 저장 또는 영속 복구 완료를 기다리게 합니다.
- **완료 조건:** 쓰기 권한 없음·디스크 부족·iCloud 다운로드 대기·앱 종료 후 재실행에서 미저장 문장을 복원할 수 있어야 합니다.
- **코드:** [store.ts:50](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/vault/store.ts:50>) · [store.ts:545](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/vault/store.ts:545>) · [ui-mode.ts:54](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/store/ui-mode.ts:54>)

### F05 · P1 · 한글 파일명과 같은 초의 쓰기가 백업 이름 충돌을 일으킴

- **영역 / 근거 / 규모:** 백업 · R · S
- **문제와 영향:** 백업 이름이 초 단위 시각과 ASCII 외 문자를 밑줄로 바꾼 경로로 구성됩니다. 같은 초의 가.md와 나.md는 같은 이름이 됩니다.
- **확인한 결과:** 동일 시각에 두 한글 파일을 백업하자 파일 하나만 남고 첫 원본이 두 번째 원본으로 교체됐습니다. 같은 파일을 같은 초에 여러 번 저장해도 충돌 가능한 구조입니다.
- **수정 방향:** 원본 경로와 복구 메타데이터를 보존하고 UUID 등으로 충돌 없는 이름을 예약합니다. 백업 실패를 호출자에게 명확히 전달합니다.
- **완료 조건:** 한글·긴 경로·동일 파일의 연속 쓰기 모두에서 각 버전을 구별해 복원할 수 있어야 합니다.
- **코드:** [tools.py:112](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/plugins/vault/tools.py:112>) · [tools.py:131](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/plugins/vault/tools.py:131>)

### F06 · P1 · 심볼릭 링크를 통해 보관함 밖 파일을 읽거나 쓸 수 있음

- **영역 / 근거 / 규모:** 파일 경계 · R · M
- **문제와 영향:** Electron 경계 검사는 문자열 경로에 의존합니다. Python의 개별 읽기는 실제 경로를 검사하지만, rg 실행이 실패했을 때의 검색 대체 경로는 링크 파일을 그대로 읽습니다.
- **확인한 결과:** 보관함 내부 링크를 통한 외부 임시 파일 읽기·디렉터리 링크를 통한 외부 파일 변경을 재현했습니다. Python 대체 검색도 외부 표식 문장을 반환했습니다. 원격 공격이나 실제 개인 파일 접근을 수행한 것은 아닙니다.
- **수정 방향:** 읽기·검색·쓰기·이름 변경·녹음 저장이 같은 실제 경로 경계 규칙을 사용하도록 합니다. 링크 지원 여부를 명시하고 생성·교체 직전의 경계도 확인합니다.
- **완료 조건:** 파일 링크·디렉터리 링크·깨진 링크·검색 대체 경로에서 동일한 허용/거부 결과를 내야 합니다.
- **코드:** [vault-fs.ts:53](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-fs.ts:53>) · [vault-service.ts:539](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-service.ts:539>) · [tools.py:344](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/plugins/vault/tools.py:344>)

### F07 · P1 · 업데이트가 사용자가 추가한 파일까지 앱 소유로 취급함

- **영역 / 근거 / 규모:** 업데이트 · R · M
- **문제와 영향:** 업데이트 후 설치 폴더 전체를 읽어 소유 파일 목록을 다시 만듭니다. 사용자가 추가한 파일도 다음 버전에서 제거 가능한 앱 파일로 편입됩니다.
- **확인한 결과:** 격리 설치에 my-notes.txt를 추가한 뒤 v2→v3 업데이트에서 해당 파일이 삭제됐습니다. 새 번들과 이름이 겹치는 기존 사용자 custom.py는 첫 갱신부터 교체됐습니다.
- **수정 방향:** 소유 목록을 배포 번들의 파일 목록으로 한정합니다. 기존 사용자 파일과 새 번들이 충돌하면 보존·충돌 처리를 수행합니다.
- **완료 조건:** 연속 3회 업데이트, 사용자 파일 추가, 신규 번들과 이름 충돌 후에도 사용자 파일과 설치 상태 표식이 잘못 삭제되지 않아야 합니다.
- **코드:** [agent-source.ts:188](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/agent-source.ts:188>) · [agent-source.ts:278](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/agent-source.ts:278>)

### F08 · P1 · 업데이트 중 실패하면 새 버전과 이전 버전이 섞여 재시도도 막힘

- **영역 / 근거 / 규모:** 업데이트 복구 · R · L
- **문제와 영향:** 현재 설치에서 먼저 파일을 지우고 순서대로 복사한 다음 마지막에 소유 표식을 갱신합니다. 중간 실패를 되돌리는 장치가 없습니다.
- **확인한 결과:** 실제 임시 파일 복사에서 두 번째 복사에 실패를 주입하자 첫 파일은 신버전, 두 번째는 구버전, 제거 대상은 사라진 상태가 됐습니다. 재시도는 locally-modified로 거절됐습니다.
- **수정 방향:** 별도 폴더에서 전체 버전을 준비·검증한 후 교체하고, 실패하면 이전 정상 버전으로 돌아갑니다. 중단된 업데이트를 다음 실행에서 인식하도록 합니다.
- **완료 조건:** 각 복사·삭제·표식 저장 단계의 실패와 앱 중단 후에도 이전 또는 새 정상 버전 하나로 부팅할 수 있어야 합니다.
- **코드:** [agent-source.ts:268](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/agent-source.ts:268>) · [agent-source.ts:290](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/agent-source.ts:290>)

### F09 · P1 · Python 의존성이 바뀌어도 기존 실행 환경을 그대로 사용함

- **영역 / 근거 / 규모:** 업데이트 의존성 · C · M
- **문제와 영향:** 소스 갱신의 depsChanged 결과를 로그에만 남기고 기존 Python 실행 환경으로 백엔드를 시작합니다.
- **확인한 결과:** 소스 갱신→로그→기존 백엔드 시작 경로를 확인했습니다. 새 의존성이 필요한 실제 출시 버전 간 설치 시험은 하지 않았습니다.
- **수정 방향:** 소스와 의존성을 같은 버전 단위로 준비하고, 새 환경에서 백엔드가 정상 응답하는지 확인한 뒤 활성화합니다.
- **완료 조건:** 새 Python 패키지 추가·삭제·버전 변경이 포함된 업데이트와 의존성 설치 실패 후 복구를 검증해야 합니다.
- **코드:** [main.ts:3171](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/main.ts:3171>) · [main.ts:3803](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/main.ts:3803>)

### F10 · P1 · 캘린더 서버 오류가 기존 일정 삭제로 이어짐

- **영역 / 근거 / 규모:** 캘린더 동기화 · R · M
- **문제와 영향:** 구독 읽기 실패 후에도 전체 예상 일정 집합으로 삭제를 진행합니다. 실패한 구독의 기존 일정은 예상 집합에 없으므로 제거됩니다.
- **확인한 결과:** 첫 동기화에서 생성한 일정 1개가 다음 HTTP 503 응답 후 삭제됐습니다. 오류 1건, 삭제 1건, 남은 일정 0개였습니다. HTTP 응답만 대체하고 실제 동기화·파일 코드를 사용했습니다.
- **수정 방향:** 구독별 마지막 정상 결과를 유지하고, 성공적으로 읽고 검증한 구독에 대해서만 삭제를 계산합니다.
- **완료 조건:** 503·시간 초과·잘못된 응답·여러 구독 중 하나의 실패가 기존 일정 삭제로 연결되지 않아야 합니다.
- **코드:** [vault-ics.ts:406](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-ics.ts:406>) · [vault-ics.ts:477](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-ics.ts:477>)

### F11 · P1 · 동기화 일정에 사용자가 쓴 메모가 다음 동기화에서 사라짐

- **영역 / 근거 / 규모:** 캘린더 메모 · R · M
- **문제와 영향:** 생성된 일정은 일반 노트로 편집할 수 있지만 동기화는 파일 전체를 외부 일정에서 다시 생성합니다.
- **확인한 결과:** 동기화로 만든 일정에 사용자 문장을 추가한 뒤 내용이 같은 외부 일정을 다시 받아도 사용자 문장이 사라졌습니다.
- **수정 방향:** 외부 일정 필드와 사용자 메모의 소유 영역을 나누거나 연결된 별도 노트로 보존합니다. 제목 변경·취소에서도 메모의 연결을 유지합니다.
- **완료 조건:** 외부 일정 변경·취소·구독 이름 변경 후에도 사용자 추가 내용이 보존되거나 명시적으로 복구 가능해야 합니다.
- **코드:** [vault-ics.ts:455](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-ics.ts:455>)

### F12 · P1 · 같은 분·같은 제목의 녹음이 합쳐지고 취소가 이전 녹음도 제거함

- **영역 / 근거 / 규모:** 회의 녹음 · R · M
- **문제와 영향:** 녹음 경로가 분 단위 시각과 제목으로 결정되고, 같은 경로에 바이트를 이어 씁니다. 폐기는 현재 경로를 휴지통으로 옮깁니다.
- **확인한 결과:** 동일 제목으로 같은 분에 시작한 두 녹음이 같은 경로를 사용하고 두 바이트 배열이 합쳐졌습니다. 두 번째 녹음을 버리면 첫 녹음까지 원래 위치에서 없어졌습니다. 미디어 입력은 대체했으며 실제 마이크는 사용하지 않았습니다.
- **수정 방향:** 녹음마다 충돌 없는 식별자와 폴더를 예약하고, 취소가 해당 녹음이 만든 자원만 처리하도록 합니다.
- **완료 조건:** 빠른 중지·재시작·같은 제목·취소·중단 복구에서 녹음 파일 소유권과 재생 가능성을 확인해야 합니다.
- **코드:** [recorder.ts:61](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/recorder.ts:61>) · [recorder.ts:137](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/recorder.ts:137>) · [recorder.ts:323](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/recorder.ts:323>)

### F13 · P1 · 긴 Inbox 노트에 자동 기억을 추가하면 기존 끝부분이 잘림

- **영역 / 근거 / 규모:** AI 자동 기억 · R · M
- **문제와 영향:** 자동 저장이 모델 표시용으로 길이를 제한한 vault_read 결과를 전체 원본처럼 사용해 다시 기록합니다. 읽기 오류도 새 파일 생성처럼 취급합니다.
- **확인한 결과:** 125,028바이트의 임시 Inbox가 자동 추가 후 120,067바이트가 됐고 끝의 표식이 없어졌으며 파일에 truncated 표시가 들어갔습니다.
- **수정 방향:** 내부 저장에는 생략 없는 구조화된 읽기 또는 충돌을 확인하는 추가 쓰기를 사용합니다. 읽기 실패와 파일 없음은 별도로 처리합니다.
- **완료 조건:** 큰 파일·읽기 실패·동시 사용자 편집 후에도 기존 내용과 새 기억이 모두 보존되어야 합니다.
- **코드:** [__init__.py:219](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/plugins/memory/vault/__init__.py:219>) · [tools.py:177](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/plugins/vault/tools.py:177>)

### F14 · P1 · 앞 400자가 같은 다른 메일 본문에 이전 승인이 재사용됨

- **영역 / 근거 / 규모:** 메일 승인 · R · M
- **문제와 영향:** 승인 식별자가 전체 전송 내용이 아닌 400자 미리보기를 포함한 reason의 해시에서 생성됩니다. 뒤쪽만 다른 두 본문이 같은 승인으로 묶입니다.
- **확인한 결과:** 실제 mail_send와 승인 모듈에서 첫 요청에 세션 승인을 주고 다른 끝부분의 두 번째 요청을 실행했습니다. 승인 콜백 1회로 서로 다른 전송 내용 2개가 전달됐습니다. 최종 전송은 대체해 실제 이메일은 보내지 않았습니다.
- **수정 방향:** 확정한 발신 계정·수신자·제목·본문 전체를 승인 대상의 식별자로 묶고 전체 내용을 펼쳐 볼 수 있게 합니다. 메일의 1회·세션·항상 허용 정책도 일관되게 정의합니다.
- **완료 조건:** 본문 401자 이후·발신 계정·참조·숨은 참조 중 하나라도 바뀌면 승인 범위에 맞게 재검토가 필요해야 합니다.
- **코드:** [tools.py:567](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/plugins/mail/tools.py:567>) · [approval.py:3155](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/tools/approval.py:3155>) · [approval.tsx:214](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/components/assistant-ui/tool/approval.tsx:214>)

### F15 · P1 · 계정 전환 직후 이전 메시지 ID를 새 계정에 적용할 수 있음

- **영역 / 근거 / 규모:** 메일 계정 전환 · C · M
- **문제와 영향:** 계정을 바꿔도 이전 목록이 잠시 남고 클릭할 수 있습니다. 검색 응답에는 세대 검사가 없으며 메시지 작업은 현재 계정과 남아 있는 메시지 ID를 조합합니다.
- **확인한 결과:** 목록 유지·검색 응답 처리·읽기/이동 호출을 추적했습니다. 실제 여러 메일 계정으로 읽기·삭제·이동은 실행하지 않았으므로 사용자 피해 발생을 확인한 것은 아닙니다.
- **수정 방향:** 메시지 정체성을 계정·폴더·ID로 고정하고 요청 취소/세대 검사를 통일합니다. 전환 중 이전 항목의 변경 작업을 막습니다.
- **완료 조건:** A 계정 검색이 늦게 도착하는 동안 B로 전환하고 동일 ID 항목을 누르는 상황에서 잘못된 계정에 어떤 작업도 적용되지 않아야 합니다.
- **코드:** [mail-view.tsx:172](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/mail-view.tsx:172>) · [mail-view.tsx:333](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/mail-view.tsx:333>) · [mail-view.tsx:365](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/mail-view.tsx:365>) · [mail-view.tsx:115](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/mail-view.tsx:115>)

### F16 · P1 · 노트 줄 순서가 바뀌면 다른 할 일의 날짜를 수정함

- **영역 / 근거 / 규모:** 일정 이동 · R · M
- **문제와 영향:** 기억한 줄 번호에 날짜 표식이 있으면 제목을 확인하지 않고 해당 줄을 수정합니다. 제목 검사는 주변 줄을 찾을 때만 합니다.
- **확인한 결과:** 화면이 Alpha의 1번 줄을 기억한 뒤 파일을 Beta 1번·Alpha 2번으로 바꾸고 Alpha를 이동하자 Beta 날짜가 바뀌고 Alpha는 그대로였습니다.
- **수정 방향:** 원래 줄에서도 대상의 정체성을 확인하고, 이동한 줄을 찾을 때 중복·모호함을 처리합니다. 필요하면 안정적인 할 일 ID를 도입합니다.
- **완료 조건:** 앞줄 삽입·정렬·같은 제목의 여러 할 일·외부 편집 후에도 선택한 대상만 수정되거나 안전하게 실패해야 합니다.
- **코드:** [quick-event.tsx:94](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/quick-event.tsx:94>)

### F17 · P2 · 전체 Todo 화면이 최근 300개 노트·100개 항목 범위에 제한됨

- **영역 / 근거 / 규모:** 할 일 완전성 · C · M
- **문제와 영향:** 대시보드용으로 만든 제한된 스캔을 Todo·달력에서도 사용하며 완료 항목도 100개 한도를 차지합니다.
- **확인한 결과:** 최근 300개 노트로 자르는 경로와 호출 한도 100을 확인했습니다. 제한 자체는 의도된 최적화지만 전체 할 일을 보여주는 화면에서 범위와 누락이 드러나지 않는 것이 문제입니다.
- **수정 방향:** 할 일을 파생 색인에 증분 저장하고 전체 개수와 화면 페이지 크기를 분리합니다. 색인 중·일부 미다운로드 상태를 표시합니다.
- **완료 조건:** 오래된 노트의 미완료·연체 항목과 100개 이상의 완료 항목 뒤에 있는 미완료 항목을 찾을 수 있어야 합니다.
- **코드:** [vault-service.ts:704](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-service.ts:704>) · [todos-store.ts:65](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/todos-store.ts:65>)

### F18 · P2 · 일정 쓰기 실패를 성공으로 보고 입력을 지움

- **영역 / 근거 / 규모:** 일정 저장 피드백 · R · S
- **문제와 영향:** vault.write의 ok:false 반환을 확인하지 않고 이동은 true를 반환하며 새 일정 입력은 비웁니다.
- **확인한 결과:** 실제 함수에 unreadable 실패 결과를 반환하자 이동 성공 true가 반환됐습니다. 충돌도 같은 결과 확인 누락의 영향을 받습니다.
- **수정 방향:** 구조화된 저장 결과를 확인해 실패 원인·재시도를 표시하고 입력과 선택 상태를 유지합니다.
- **완료 조건:** 충돌·iCloud 다운로드 대기·쓰기 실패 시 성공 표시나 입력 삭제가 없어야 합니다.
- **코드:** [quick-event.tsx:61](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/quick-event.tsx:61>) · [quick-event.tsx:89](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/quick-event.tsx:89>) · [quick-event.tsx:139](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/quick-event.tsx:139>)

### F19 · P2 · 요약·답장·노트 저장 요청에서 선택한 메일 계정이 빠짐

- **영역 / 근거 / 규모:** 메일 AI · C · S
- **문제와 영향:** AI 요청에 ID와 INBOX만 넣고 계정을 생략합니다. 도구는 계정 생략 시 기본 계정을 사용합니다.
- **확인한 결과:** 세 버튼의 프롬프트와 도구의 기본 계정 해석을 확인했습니다. 모델이 실제로 다른 계정 메일을 선택하는지까지 시험하지 않았습니다.
- **수정 방향:** 현재 선택된 계정·폴더·메시지 ID를 AI 작업에 명시적으로 전달하고 작업 결과에도 출처 계정을 표시합니다.
- **완료 조건:** 두 계정에 같은 ID가 있어도 선택한 계정의 메일만 요약·초안·노트 저장 대상으로 사용해야 합니다.
- **코드:** [mail-view.tsx:424](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/mail-view.tsx:424>) · [mail-view.tsx:440](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/mail-view.tsx:440>) · [tools.py:272](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/plugins/mail/tools.py:272>)

### F20 · P2 · 따옴표로 감싼 YAML 키를 수정하면 문서 속성이 깨짐

- **영역 / 근거 / 규모:** 노트 속성 · R · S
- **문제와 영향:** 속성 편집이 원문의 키 문자열을 비교해 따옴표가 있는 기존 키를 놓치고 같은 의미의 새 키를 추가합니다.
- **확인한 결과:** 유효한 "status": todo를 편집하자 status: done이 추가돼 중복 키가 되었고 파싱 상태가 ok에서 invalid로 바뀌었습니다.
- **수정 방향:** YAML 파서가 해석한 키와 원문 위치를 함께 사용해 정확한 범위만 교체하고 기존 표현을 보존합니다.
- **완료 조건:** 따옴표 키·한글 키·주석·여러 줄 값·중복 키가 있는 파일을 안전하게 처리해야 합니다.
- **코드:** [frontmatter.ts:87](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/frontmatter.ts:87>) · [frontmatter.ts:130](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/frontmatter.ts:130>)

### F21 · P2 · 온보딩 파일 드롭이 파일을 읽지 않고 선호 설정에 경로를 저장함

- **영역 / 근거 / 규모:** 첫 사용 · R · M
- **문제와 영향:** 현재 여섯 페르소나의 질문은 모두 preferences이며 파일 드롭도 그 응답 경로로 갑니다. 파일을 읽으라는 문장과 경로가 SOUL에 저장되고 완료됩니다.
- **확인한 결과:** 실제 설정 함수에 PDF 경로를 전달했을 때 SOUL에 경로·Read them 문장만 추가되고 상태가 done이 됐습니다. PDF를 읽거나 내용을 반영한 결과는 생성되지 않았습니다.
- **수정 방향:** 선호 설정 답변과 파일 가져오기를 분리합니다. 파일 접수→읽기→내용 미리보기→노트 반영의 실제 진행 상태를 제공하고 성공 후에만 완료를 표시합니다.
- **완료 조건:** 시간표/PDF 드롭 후 내용을 근거로 한 결과가 나오며 읽기 불가·취소·재시도 시 입력 파일과 상태가 유지되어야 합니다.
- **코드:** [setup-chat.tsx:65](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/setup-chat.tsx:65>) · [setup-agent.ts:173](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/setup-agent.ts:173>) · [personas.ts:117](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/personas.ts:117>)

### F22 · P2 · 요청한 한국어 전사 설정이 실제 전사 호출에서 빠짐

- **영역 / 근거 / 규모:** 음성 전사 · R · M
- **문제와 영향:** 회의 도구가 language를 넘기지만 하위 함수는 이를 받지 않아 TypeError 후 언어 없이 재호출합니다. 확인한 로컬 설정 기본값은 en입니다.
- **확인한 결과:** 실제 호출 경로와 설정을 사용하고 전사 모델만 대체했을 때 ko 요청의 최종 모델 호출 언어가 en이었습니다. 실제 음성 인식 정확도는 측정하지 않았습니다.
- **수정 방향:** 호출 단위 언어 또는 자동 감지를 하위 전사 경로까지 전달하고 현재 선택과 실패를 화면에 표시합니다.
- **완료 조건:** 한국어·영어·자동 감지 요청이 각 백엔드에 그대로 전달되고 혼합 언어 녹음으로 실제 결과를 확인해야 합니다.
- **코드:** [tools.py:62](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/plugins/meetings/tools.py:62>) · [transcription_tools.py:1775](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/tools/transcription_tools.py:1775>) · [config.py:2330](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/hermes_cli/config.py:2330>)

### F23 · P2 · 노트 도구와 자동 기억이 서로 다른 보관함 설정을 읽음

- **영역 / 근거 / 규모:** AI 기억 활성화 · R · M
- **문제와 영향:** 노트 도구의 데스크톱 연결 정보와 달리 기억 제공자는 VAULT_PATH만 확인합니다. 백엔드 시작 후 보관함을 여는 흐름에서 차이가 드러날 수 있습니다.
- **확인한 결과:** 유효한 데스크톱 보관함 연결 정보가 있고 VAULT_PATH가 없을 때 노트 도구는 루트를 찾지만 기억 제공자는 사용 불가를 반환했습니다.
- **수정 방향:** 공통 보관함 해석기를 사용하고 세션별 대상 보관함을 고정합니다. 활성화 시점은 세션 생명주기에 맞춰 처리해 대화 중 시스템 프롬프트나 도구 목록을 바꾸지 않습니다.
- **완료 조건:** 최초 설치·나중에 보관함 열기·프로필/보관함 전환에서 도구와 기억의 대상 및 활성 상태가 일치해야 합니다.
- **코드:** [__init__.py:97](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/plugins/memory/vault/__init__.py:97>) · [__init__.py:243](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/plugins/memory/vault/__init__.py:243>) · [vault-ipc.ts:26](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-ipc.ts:26>)

### F24 · P2 · 긴 대화의 최신 결정이 자동 기억 후보에서 빠짐

- **영역 / 근거 / 규모:** AI 기억 품질 · R · S
- **문제와 영향:** 최근 40개 메시지를 오래된 순서부터 예산에 넣고 제한을 넘으면 중단하므로, 가장 최근의 수정·결론이 제외됩니다.
- **확인한 결과:** 각 1,200자 메시지 40개에서 앞쪽 00~19만 남았고 마지막 사용자 38·응답 39가 빠졌습니다.
- **수정 방향:** 최신 메시지부터 예산을 확보한 후 시간 순서로 정렬합니다. 마지막 사용자 정정과 확정 사항을 우선 보존합니다.
- **완료 조건:** 긴 대화 끝의 정정 내용이 이전 잘못된 사실보다 우선해 기억 후보에 포함되어야 합니다.
- **코드:** [__init__.py:122](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/plugins/memory/vault/__init__.py:122>)

### F25 · P2 · 마지막 구독을 해제하면 기존 동기화 일정이 그대로 남음

- **영역 / 근거 / 규모:** 캘린더 구독 · R · S
- **문제와 영향:** 구독이 하나도 없으면 정리 단계 전에 반환하므로 마지막 구독 해제만 다른 해제와 동작이 달라집니다.
- **확인한 결과:** 일정 하나가 있는 마지막 구독을 제거한 상태의 동기화에서 removed 0, remaining 1을 확인했습니다.
- **수정 방향:** 구독 해제 시 해당 구독 소유 일정을 명시적으로 정리하거나 로컬 일정으로 남길지 선택하게 합니다. 사용자 메모 보존 정책과 연결합니다.
- **완료 조건:** 하나·여러 구독의 해제 결과가 일관되고 남은 일정은 동기화 중인지 로컬 사본인지 구별되어야 합니다.
- **코드:** [vault-ics.ts:399](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-ics.ts:399>) · [vault-ics.ts:524](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-ics.ts:524>)

### F26 · P2 · 반복 일정 예외·변경·시간대 지원이 불완전함

- **영역 / 근거 / 규모:** 캘린더 정확성 · R · M
- **문제와 영향:** 간소화한 반복 규칙 해석은 EXDATE·RECURRENCE-ID·STATUS·DTEND 등의 의미를 충분히 반영하지 않으며 TZID의 다른 지역 시각 처리도 제한적입니다.
- **확인한 결과:** DAILY COUNT=2와 첫 회 EXDATE를 넣었지만 제외될 날짜까지 두 번 모두 생성됐습니다. 시간대·취소·이동·종일/여러 날 문제는 코드 확인이며 실제 제공자별 검증은 남아 있습니다.
- **수정 방향:** 검증된 일정 해석기를 경계 모듈에서 사용하거나 지원 범위를 명확히 표시합니다. UID·구독·발생 회차를 기준으로 일정을 식별합니다.
- **완료 조건:** 반복 1회 취소/이동, DST, 다른 시간대, 종일·여러 날 일정의 기대 날짜를 실제 구독 예시와 대조해야 합니다.
- **코드:** [vault-ics.ts:111](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-ics.ts:111>) · [vault-ics.ts:203](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-ics.ts:203>) · [vault-ics.ts:337](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/vault/vault-ics.ts:337>)

### F27 · P2 · 선택 날짜·로컬 날짜·UTC 날짜가 섞임

- **영역 / 근거 / 규모:** 날짜 일관성 · C · S
- **문제와 영향:** 미래 날짜의 Daily 노트를 만들 때 템플릿의 {{date}}는 오늘을 넣습니다. 회의 폴더는 로컬 날짜지만 노트 날짜는 UTC ISO 문자열에서 가져옵니다.
- **확인한 결과:** 날짜를 전달하는 호출과 템플릿/회의 날짜 계산을 확인했습니다. 실제 자정·시간대 변경 전체 앱 시험은 하지 않았습니다.
- **수정 방향:** 목적 날짜를 템플릿에 명시적으로 전달하고 사용자 날짜를 만드는 공통 함수를 사용합니다.
- **완료 조건:** 과거/미래 Daily 생성과 Sydney 오전·자정 전후의 회의에서 파일명·속성·달력 표시 날짜가 일치해야 합니다.
- **코드:** [calendar-view.tsx:81](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/calendar-view.tsx:81>) · [templates.ts:42](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/templates.ts:42>) · [meetings-view.tsx:78](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/meetings-view.tsx:78>)

### F28 · P2 · 일부 입력창이 한글 조합 중 Enter를 실행으로 처리할 수 있음

- **영역 / 근거 / 규모:** 한국어 입력 · C · S
- **문제와 영향:** 설정 답변·일정 추가·회의 제목·속성 편집의 Enter 처리에 조합 중 여부 검사가 없습니다. 기존 채팅 입력에는 방어 코드가 있습니다.
- **확인한 결과:** 입력 이벤트 핸들러를 비교했습니다. 실제 macOS 한국어 IME로 오작동을 재현한 것은 아닙니다.
- **수정 방향:** 기존 입력 처리 패턴을 공유하고 조합 확정 Enter와 제출 Enter를 구별합니다.
- **완료 조건:** 한국어·일본어 입력에서 조합 확정만으로 제출·녹음 시작·속성 확정이 일어나지 않아야 합니다.
- **코드:** [setup-chat.tsx:125](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/setup-chat.tsx:125>) · [quick-event.tsx:155](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/quick-event.tsx:155>) · [meetings-view.tsx:142](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/meetings-view.tsx:142>) · [properties-panel.tsx:101](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/properties-panel.tsx:101>)

### F29 · P2 · 다른 화면으로 이동하면 녹음 상태와 중지 조작이 사라짐

- **영역 / 근거 / 규모:** 녹음 가시성 · C · S
- **문제와 영향:** 녹음은 공유 상태에서 계속되지만 녹음 UI는 Meetings 화면에만 있습니다. 모듈 전환 시 해당 화면이 사라집니다.
- **확인한 결과:** 공유 녹음 수명과 조건부 화면 구성을 확인했습니다. 실제 마이크 녹음·화면 전환 시험은 하지 않았습니다.
- **수정 방향:** 모든 화면에 현재 녹음 시간·저장 상태·중지 버튼을 작게 고정 표시합니다.
- **완료 조건:** 노트·메일·달력으로 이동해도 녹음 여부와 중지 기능이 접근 가능해야 합니다.
- **코드:** [notes-shell.tsx:171](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/notes-shell.tsx:171>) · [meetings-view.tsx:28](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/meetings-view.tsx:28>) · [recorder.ts:196](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/recorder.ts:196>)

### F30 · P2 · 부분 집계·연결 실패·설정 실패가 정상 상태처럼 보임

- **영역 / 근거 / 규모:** 상태·오류 안내 · C · M
- **문제와 영향:** 홈 읽지 않은 메일 수는 최신 5개만 집계하며 조회 실패는 연결 안 됨으로 표시합니다. 페르소나 적용의 soulError도 다음 단계 이동 시 확인하지 않습니다.
- **확인한 결과:** 집계 범위와 오류 분기, 반환 결과 소비를 확인했습니다. 모든 연동 실패 화면을 실계정으로 시험하지 않았습니다.
- **수정 방향:** 정확한 전체 수와 일부 결과를 구분하고 미설정·로딩·오래된 데이터·실패를 명확히 표시합니다. 설정의 부분 성공은 재시도 항목으로 남깁니다.
- **완료 조건:** 느린 연결·만료 인증·부분 설정 실패에서 성공 오인이나 불필요한 재연결 유도가 없어야 합니다.
- **코드:** [home-view.tsx:124](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/home-view.tsx:124>) · [persona-store.ts:176](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/persona-store.ts:176>) · [onboarding-wizard.tsx:60](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/onboarding-wizard.tsx:60>)

### F31 · P2 · 보조 앱이 DAAT와 다른 기본 데이터 폴더를 읽음

- **영역 / 근거 / 규모:** DAAT Cat · C · S
- **문제와 영향:** DAAT의 기본 홈은 ~/.daat인데 보조 앱의 기본값은 ~/.hermes입니다. 실행 경로에서 활성 프로필·홈을 명시적으로 전달하지 않습니다.
- **확인한 결과:** 두 기본값과 보조 앱 시작 인수를 확인했습니다. Finder에서 실행한 배포 앱과 여러 프로필 조합은 추가 검증 대상입니다.
- **수정 방향:** 활성 런타임·프로필 경로를 명시적으로 전달하고 읽는 대상과 연결 상태를 표시합니다.
- **완료 조건:** Finder 실행·커스텀 홈·복수 프로필에서 DAAT와 Cat이 같은 세션·작업 상태를 보여야 합니다.
- **코드:** [DaatAppStateReader.swift:14](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/daatcat/Sources/DaatCat/Daat/DaatAppStateReader.swift:14>) · [main.ts:532](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/main.ts:532>) · [menubar-cat.ts:78](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/electron/menubar-cat.ts:78>)

### F32 · P2 · 기존 패키지 시험 도구가 이전 Hermes 앱 이름을 가정함

- **영역 / 근거 / 규모:** 배포 검증 · C · S
- **문제와 영향:** macOS 시험 경로가 Hermes.app/Contents/MacOS/Hermes로 고정되어 현재 Daat 브랜딩과 다릅니다.
- **확인한 결과:** 공식 시험 스크립트의 경로와 패키지 설정을 대조했습니다. 별도의 probe-packaged 도구는 존재하므로 패키지 검증 기능이 전혀 없다고 판단한 것은 아닙니다.
- **수정 방향:** 빌드 메타데이터에서 앱 이름·아키텍처·실행 경로를 가져오고 실제 배포 산출물을 입력받게 합니다.
- **완료 조건:** 실제 Daat 배포 파일에 대해 최초 설치·기존 설치·업데이트 시험이 같은 진입점으로 실행되어야 합니다.
- **코드:** [test-desktop.mjs:20](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/scripts/test-desktop.mjs:20>) · [package.json:1](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/package.json:1>)

### F33 · P2 · 한글 사용 경험과 키보드 접근이 화면마다 일관되지 않음

- **영역 / 근거 / 규모:** 언어·접근성 · C · M
- **문제와 영향:** 일부 Todo·메일 문구는 영어로 고정되어 있고, 사용자 정의 오버레이의 대화상자 의미/포커스 관리와 hover 중심 작업의 키보드 접근을 보완할 필요가 있습니다.
- **확인한 결과:** 소스와 격리 실행의 기본 컨트롤 이름을 점검했습니다. 화면 읽기 프로그램, 색 대비, 모든 키보드 경로를 시험하지 않았으므로 접근성 기준 준수 여부를 판정하지 않습니다.
- **수정 방향:** 제품 문자열을 한곳에서 관리하고 모달·필드·아이콘 버튼의 이름, 포커스 이동·복귀, 키보드 조작을 공통 컴포넌트로 보장합니다.
- **완료 조건:** 키보드만으로 첫 설정·노트 생성·속성 수정·모달 닫기를 수행하고 한국어 선택 시 핵심 흐름에서 언어가 섞이지 않아야 합니다.
- **코드:** [todo-view.tsx:59](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/todo-view.tsx:59>) · [onboarding-wizard.tsx:68](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/onboarding-wizard.tsx:68>) · [properties-panel.tsx:79](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/src/app/notes/properties-panel.tsx:79>)

### F34 · P3 · 현재 DAAT와 README·설계·인수인계 문서의 설명이 어긋남

- **영역 / 근거 / 규모:** 제품 문서 · C · S
- **문제와 영향:** DAAT의 노트 중심 흐름과 Hermes의 기존 채팅 중심 설계, 오래된 미완료 목록이 함께 남아 있습니다.
- **확인한 결과:** HANDOFF에서 미구현처럼 언급한 세션·메일 답장·CSP 관련 기능은 현재 코드에 존재합니다. 문서를 기준으로만 감사하면 이미 된 기능을 다시 제안하게 됩니다.
- **수정 방향:** 제품 소개·지원 범위·데이터 위치·복구·개발 실행법을 현재 구현 기준으로 정리하고 완료한 인수인계 항목을 갱신합니다.
- **완료 조건:** 처음 온 개발자가 DAAT와 기반 Hermes의 책임, 활성 코드, 사용자 데이터 위치, 공식 검증 명령을 문서만으로 구분할 수 있어야 합니다.
- **코드:** [README.md:1](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/README.md:1>) · [HANDOFF.md:1](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/HANDOFF.md:1>) · [README.md:1](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/README.md:1>) · [DESIGN.md:1](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/DESIGN.md:1>)


## 6. 추가 확인이 필요한 항목

다음은 확인된 결함 수에 포함하지 않았다.

### V01 · Cat과 Codex 로그인 갱신의 소유권

[CodexUsageProvider.swift:67](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/daatcat/Sources/DaatCat/Codex/CodexUsageProvider.swift:67>)은 Codex 인증 파일을 읽고 401 응답 시 토큰을 갱신한다. [갱신 처리](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/daatcat/Sources/DaatCat/Codex/CodexUsageProvider.swift:158>)은 새 access token을 메모리에 사용하지만 새 refresh token을 같은 방식으로 보존하지 않는다. 다음 요청은 원래 파일을 다시 읽는다. 반면 [기반 런타임 인증 주석](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/hermes_cli/auth.py:3437>)에는 토큰 회전 충돌을 피하기 위한 별도 세션 의도가 있다.

여기서는 실제 OAuth 요청을 하지 않아 토큰 회전 정책이나 로그인 손상을 확인하지 않았다. 보조 앱이 다른 앱의 인증 갱신을 담당해도 되는지, 새 토큰을 누가 소유·저장하는지 검증이 필요하다. 가능하면 인증 소유자가 제공하는 읽기용 사용량 경로를 사용하고, 실패는 사용량만 비활성화하도록 한다.

### V02 · 실제 배포 파일과 깨끗한 Mac

서명·공증·Gatekeeper, Finder 실행, 네트워크 없는 최초 시작, 기존 설치 위 업데이트, 손상 복구를 실제 산출물로 확인해야 한다. 로컬 빌드와 fake backend UI 성공으로 대체할 수 없다.

Cat 빌드는 [호스트 빌드](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/daatcat/build-app.sh:8>)와 [스테이징](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/apps/desktop/scripts/stage-daatcat.mjs:46>)에서 목표 아키텍처 검증을 보완할 필요가 있다. Intel 지원은 helper·네이티브 모듈을 포함한 실제 Intel 산출물에서 확인해야 한다. 현재 근거만으로 Intel 앱이 반드시 실행되지 않는다고 단정하지 않는다.

### V03 · 실제 첫 설정·메일·음성·클라우드 파일

- fake backend 온보딩은 다음 질문 단계에서 완주하지 못했다. 실제 백엔드 연결이 필요한 시점과 실패 시 사용자가 빠져나오는 동작을 검증한다.
- 다중 메일 계정의 느린 검색·전환·답장 초안·승인 취소를 전용 시험 계정에서 확인한다.
- 마이크 권한 거절·도중 입력 장치 제거·절전·앱 중단·실제 한국어 전사를 확인한다.
- 실제 iCloud 미다운로드 파일·오프라인·동시 외부 편집에서 원본 보존과 재색인을 확인한다.
- 파일·메일 속 외부 텍스트의 출처 표시와 지시문 경계는 개선 가치가 있다. 이번에 프롬프트 주입으로 무단 실행이 가능하다고 입증한 것은 아니다.
- Windows/Linux의 전체 설치·기반 Hermes 전체 플랫폼은 이번 macOS 제품 감사 범위 밖이다.

## 7. 공통 설계 보완

### 7.1 파일 변경 계약을 한 가지로 맞추기

편집기는 이전 내용/수정 시각으로 충돌을 검사하지만 Python 도구는 전체 교체, ICS는 직접 파일 쓰기, 녹음은 이어 쓰기다. 각 기능에 개별 방어만 더하면 같은 문제가 다시 생긴다.

공통으로 **보관함 식별자, 대상 식별자, 기대 버전, 변경 주체, 성공/충돌/실패 결과, 복구본 위치**를 기록하는 계약이 필요하다. 이를 기존 서비스와 플러그인 경계에서 구현한다. 앱 전체를 새 관리 계층으로 교체하거나 코어 도구를 늘릴 이유는 없다.

원자적 파일 교체는 파일이 반쯤 쓰이는 문제를 줄이지만, 이미 오래된 내용을 통째로 덮어쓰는 문제까지 해결하지는 않는다. 충돌 감지와 버전 보존이 함께 필요하다.

### 7.2 파일 이름 대신 소유권을 기록하기

업데이트의 사용자 파일 삭제, ICS의 사용자 메모 교체, 녹음 취소의 이전 파일 제거는 모두 “이 파일을 누가 만들고 지금 누가 수정할 권리가 있는가”가 약한 사례다.

앱 소유 런타임 파일, 외부에서 받은 일정 필드, 사용자가 쓴 본문, 녹음별 바이트를 구별해야 한다. 자동 정리는 확실히 자기 소유인 자원에만 적용하고 사용자 내용은 보존한다.

### 7.3 오류와 빈 결과를 다른 상태로 다루기

서버 실패를 일정 0개로 취급하면 삭제가 발생하고, 메일 조회 실패를 미연결로 취급하면 재설정을 유도한다. 오류를 숨기는 것보다 **마지막 정상 상태 + 현재 실패 이유 + 재시도**가 더 유용하다.

이 상태를 Home, Mail, Calendar, 온보딩, 자동 기억에서 같은 방식으로 표현한다. 입력한 내용은 재시도 중 유지한다.

### 7.4 경계의 불변 조건을 시험하기

현재 시험 수는 충분히 많다. 숫자를 늘리기보다 다음 관계를 지키는 검증이 필요하다.

- 어떤 실패에서도 저장된 사용자 바이트나 최신 입력이 설명 없이 사라지지 않는다.
- 화면에 선택한 계정·보관함·항목과 실제 변경한 대상이 같다.
- 승인한 내용과 전송한 내용이 같다.
- 업데이트 실패 후 실행 가능한 한 버전이 남는다.
- 외부 데이터 읽기 실패가 사용자의 삭제 의도로 해석되지 않는다.

순수 모듈 시험 후 실제 IPC·파일·상태 경로를 통과하는 작은 통합 시험을 추가한다. 모든 외부 호출을 성공으로 대체한 시험만으로 완료를 선언하지 않는다.

## 8. 추가하면 가치가 큰 기능

아래는 현재 코드와 제품 흐름에서 도출한 제안이다. 시장 조사나 사용자 수요 검증을 마친 로드맵은 아니다. 먼저 안정화한 뒤 작은 사용 시나리오로 검증하는 것이 적절하다.

| 순서 | 기능 | 사용자에게 주는 가치 | 기존 구조 활용 / 선행 조건 | 첫 출시 범위와 검증 기준 |
| --- | --- | --- | --- | --- |
| 1 | **변경 내역·복구 센터** | AI·동기화·직접 편집 중 무엇이 바뀌었는지 보고 되돌림 | 충돌 사본·백업을 활용. F01~F05, F11~F13 선행 | 파일별 변경 전후·변경 주체·복구 버튼. 중단 후 최신 미저장 내용도 복구 |
| 2 | **AI 작업 미리보기와 실행 결과** | 여러 파일 정리 전에 영향을 이해하고, 실패한 부분만 다시 실행 | 기존 inline AI/도구 결과 위에 추가. 공통 파일 변경 계약 필요 | 대상 파일·변경 요약·완료/실패·되돌리기. 다른 작업의 파일을 잘못 취소하지 않음 |
| 3 | **출처가 있는 AI 답변·기억 관리** | 어떤 노트/메일에서 답했는지 확인하고 잘못 기억한 내용을 수정 | 기존 vault recall·memory provider 확장. F13/F23/F24 선행 | 근거 링크, 사용된 보관함/계정, 기억 수정·잊기·저장 제외. 단순 대화 삭제와 생성된 Inbox 삭제를 구별 |
| 4 | **회의 작업함과 복구** | 녹음→전사→요약→할 일 전환의 어디서 멈췄는지 알고 이어감 | 청크 저장·공유 recorder 상태 활용. F12/F22/F29 선행 | 기존 음성 파일 가져오기, 단계별 재시도, 부분 녹음 복원, 항상 보이는 중지 버튼 |
| 5 | **신뢰할 수 있는 Today 화면** | 오래된 노트의 할 일도 포함해 오늘 처리할 일을 모음 | Todo·Daily·Mail·Calendar 연결. F15~F19/F27/F30 선행 | 정확한 범위 표시, 연체·오늘·후속 답장, 각 항목 원본 이동. 중복과 누락을 구분 |
| 6 | **Money 가져오기 검토 화면** | CSV/PDF 등에서 장부를 만들기 전 금액·중복·누락을 확인 | 현재 Money 파서·노트 구조 유지, 기존 금액 시험 활용 | 원본 행과 추출 결과 비교, 중복 후보, 통화 표시, 확정 후 기록. AUD/KRW 등을 환율 없이 합산하지 않음 |
| 7 | **통합 연결·진단 화면** | AI·메일·달력·저장 상태를 한곳에서 확인하고 재시도 | 기존 상태 API·프로필 정보 활용. F23/F30/F31/F32 선행 | 마지막 정상 연결·현재 대상·권한/오류·재시도. 내보내는 진단 자료는 비밀값 제거, 자동 외부 전송 없음 |
| 8 | **저장 가능한 표 보기와 속성 편집** | 프로젝트·수업·거래를 자기 기준의 목록으로 관리 | 현재 table-view/frontmatter 확장. F20 선행 | 필터·정렬·표시 열 저장, 날짜/숫자/선택 속성 편집. 원본 Markdown 표현 유지 |
| 9 | **주변 노트 그래프와 안전한 이름 변경** | 1만 개 전체 그래프보다 현재 작업 주변 관계를 찾음 | 기존 링크 색인·Canvas 활용. F02와 링크 해석 일관성 검증 선행 | 1~2단계 주변 연결, 필터·일시 정지, 키보드 대체 목록, 이름 변경 시 영향받는 링크 미리보기 |
| 10 | **Cat 표시·실행 설정** | 보조 앱의 실행 여부와 정보 범위를 사용자가 조절 | 기존 enabled 설정과 메뉴바 helper 활용. F31/V01 선행 | 켜기/끄기, DAAT 종료 시 동작, 표시할 정보, 읽는 계정·프로필을 명시 |

특히 변경 내역·복구와 출처 표시는 DAAT의 “내 파일을 AI가 다룬다”는 특성과 직접 연결된다. 회의 작업함은 이미 존재하는 녹음·전사·노트 생성 기능을 사용자가 끝까지 완료할 수 있도록 연결하는 확장이다.

Money의 다중 통화나 고급 장부 기능은 현재 단일 통화 중심 구현의 **확장 제안**이다. 지원한다고 약속한 기능이 깨졌다고 판정한 것은 아니다. 기능에 맞춰 거래 원본 보존·중복 판정·통화별 합계부터 명확히 하는 편이 적절하다.

## 9. 권장 실행 순서

| 단계 | 작업 묶음 | 포함 항목 | 완료 확인 |
| --- | --- | --- | --- |
| A | 데이터가 사라지거나 다른 곳에 쓰이는 경로 차단 | F01~F06, F10~F13, F16, F18 | 임시 파일/실제 IPC로 저장·충돌·취소·동기화 실패 재현이 모두 안전하게 바뀜 |
| B | 업데이트와 외부 작업 신뢰성 | F07~F09, F14~F15, F19, V01~V02 | 연속 업데이트·중간 실패 복구, 승인 내용 일치, 계정 대상 일치 |
| C | 일상 사용의 정확성 | F17, F20~F30 | 오래된 할 일·달력 예외·한국어 입력/전사·온보딩 파일·실패 재시도 확인 |
| D | 배포·보조 앱·접근성·문서 정리 | F31~F34, V03 | 실제 설치 파일 검증, 프로필 일치, 주요 키보드 흐름, 현재 문서 |
| E | 기능 확장 | 변경 내역/복구 → AI 출처/작업 결과 → 회의 작업함 | 각 기능이 원본 보존·실패 복구 위에서 사용자 시나리오 하나를 끝까지 완료 |

A/B는 관련 기능별로 함께 진행할 수 있다. 작은 수정부터 시작한다면 **F02 이름 충돌, F05 백업 충돌, F18 저장 결과 확인, F20 YAML 키, F24 최신 기억 우선**이 범위가 비교적 명확하다. F01/F03/F04는 저장 수명주기를 함께 봐야 하며 F07/F08/F09도 업데이트 단위로 묶어야 한다.

공개 배포 판단 전에는 최소한 데이터·승인·계정·업데이트 관련 P1을 해결하거나 해당 기능의 제한을 명확히 하고 실제 경로 검증을 완료하는 것이 타당하다. 자동 시험의 녹색 결과만으로 이 조건을 대신하지 않는다.

## 10. 증거와 남은 검증

[파일·이름 변경·ICS 재현 JSON](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/docs/audits/evidence/2026-09-14/runtime-probes.json>) · [저장 충돌 재현 JSON](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/docs/audits/evidence/2026-09-14/save-conflict-probe.json>) · [일정·YAML·녹음 재현 JSON](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/docs/audits/evidence/2026-09-14/ux-probes.json>) · [온보딩 파일 처리 재현 JSON](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/docs/audits/evidence/2026-09-14/onboarding-drop-probe.json>) · [시험·UI·규모 확인 로그 발췌](</Users/joseph/Documents/Project/AI OBSIDIAN/biseo-agent/docs/audits/evidence/2026-09-14/verification.txt>).

이 JSON은 해당 격리 재현의 출력이며 34개 발견 사항 전체를 자동으로 재검증하는 시험 모음은 아니다. 그 밖의 격리 재현은 감사 세션에서 수행한 결과를 각 항목에 기록했다. 외부 계정·실제 마이크·서명된 설치 파일·장시간 운영 조건은 앞의 V 항목에 남겼다.

보고서 작성 중 제품 소스 변경, 사용자 데이터 변경, 실제 메일 발송 또는 실제 설치 업데이트는 수행하지 않았다. 기존 작업 파일의 변경은 그대로 유지했다.

