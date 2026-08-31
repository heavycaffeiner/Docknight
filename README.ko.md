# Docknight

[English README](README.md)

`docker compose` 스택을 위한 셀프 호스팅 웹 인터페이스. 브라우저에서 스택을 배포, 시작, 중지,
편집, 관찰하고, 어떤 컨테이너 안에서든 셸을 열 수 있다.

스택은 compose 파일이 들어 있는 디렉터리다. Docknight는 그 파일을 제자리에서 편집하고 실제
`docker compose` CLI를 실행하므로, Docknight를 꺼도 모든 스택은 터미널에서 그대로 동작한다.
디스크에 있는 것에 대한 권위는 언제나 파일 시스템에 있다.

## 상태

**전면 재작성 진행 중.** 첫 구현은 폐기되었고, 이 저장소는 현재 두 번째 구현이 따를 개정판
기획서 세트를 담고 있다. 전체 설계는 [`docs/proposals/`](docs/proposals/) 참조:

| 기획서 | 범위 |
|--------|------|
| [0 - Foundation](docs/proposals/docknight-0-foundation.md) | 런타임, 설정, SQLite, HTTP, 컨테이너 이미지, 셀프 업그레이드 |
| [1 - Transport](docs/proposals/docknight-1-transport.md) | WebSocket 프로토콜, 라우팅, 에러, 모바일 대응 재연결 |
| [2 - Auth](docs/proposals/docknight-2-auth.md) | 로그인, TOTP, 세션, 설정 저장소, 오프라인 복구 |
| [3 - Stack](docs/proposals/docknight-3-stack.md) | 스택 발견, 원자적 파일 쓰기, compose 실행, 상태 추적 |
| [4 - Terminal](docs/proposals/docknight-4-terminal.md) | pty 레지스트리, 스크롤백, 컨테이너 exec, 호스트 셸 |
| [5 - Agent](docs/proposals/docknight-5-agent.md) | 멀티 호스트 페더레이션 |
| [6 - Frontend shell](docs/proposals/docknight-6-frontend-shell.md) | 디자인 시스템, 크기 클래스, 포인터 밀도, 뷰포트와 키보드 처리 |
| [7 - Frontend features](docs/proposals/docknight-7-frontend-features.md) | 모든 화면, 컴팩트 명세 포함 |
| [8 - Design verification](docs/proposals/docknight-8-design-verification.md) | 레이아웃 감사기, 실기기 지오메트리 매트릭스, 픽스처 백엔드, CI |

재작성의 이유: 첫 프런트엔드는 컴팩트 레이아웃을 데스크톱 레이아웃의 축소판으로 다뤘고, 검증
매트릭스는 폰 지오메트리를 한 번도 렌더링하지 않았다. 기획서 6에서 8은 그 교정을 디자인 시스템과
테스트 매트릭스 자체에 넣은 전면 재작성이고, 0에서 5는 명확화만 반영한 재발행이다.

## 앞으로 제공할 기능

- 디렉터리를 스캔해 스택을 찾고 `docker compose ls`가 보고하는 것과 병합. Docknight가 만들지
  않은 스택도 포함.
- 주석을 보존하면서 서로 동기화되는 YAML 편집기와 폼으로 `compose.yaml`과 `.env` 편집.
- 배포, 시작, 중지, 재시작, 업데이트, down, 삭제를 실행하며 실제 명령 출력을 스트리밍.
- 서비스별 상태와 헬스, 컨테이너 CPU와 메모리 표시.
- 어떤 컨테이너 안에서든 셸 열기, 선택적으로 호스트 셸.
- 다른 Docknight 호스트의 스택을 하나의 인터페이스에서 관리.
- 단일 관리자, 선택적 2단계 인증, 폐기 가능한 세션.
- 폰에서 제대로 동작: 터치 크기 타깃, 키보드를 인식하는 레이아웃, 엄지 영역의 주요 동작.

## 요구 사항

- Docker Engine 20 이상과 Compose v2 플러그인이 있는 Linux 호스트. Podman은 `podman-docker`로
  동작한다.
- 해당 호스트의 `/var/run/docker.sock` 접근 권한.
- Docknight는 Docker 데몬 전체를 제어한다. 로그인할 수 있는 사람은 호스트에서 무엇이든 실행할 수
  있으므로, 자체 네트워크 경계 뒤에 두고 5001 포트를 인터넷에 노출하지 말 것.

## 이미지

`ghcr.io/heavycaffeiner/docknight`에 게시된다.

| 태그 | 갱신 시점 | 용도 |
|------|-----------|------|
| `stable`, `latest`, `<version>` | `v*` 릴리스 태그 | 일반 배포 |
| `nightly` | `main`의 모든 커밋 | 미출시 작업 테스트 |

릴리스는 게시 전에 전체 브라우저 매트릭스를 실행한다. `nightly`는 유닛 테스트만 거치므로 깨질
수 있다. 두 채널 모두 `linux/amd64`와 `linux/arm64`용으로 빌드된다.

### 릴리스 만들기

`v` 태그를 푸시하면 나머지는 CI가 처리한다. 전체 검증을 실행하고, 릴리스 버전으로 이미지를
게시하고, `stable`과 `latest`를 옮기고, 새 `version.json`을 커밋하고, GitHub 릴리스를 만든다.

```sh
git tag v1.7.0
git push origin v1.7.0
```

`version.json`은 실행 중인 인스턴스가 새 릴리스를 발견하려고 폴링하는 파일이라 손으로 고치지
않고 릴리스 잡이 쓴다. 릴리스와 그것을 알리는 매니페스트가 어긋날 수 없다.

## 라이선스

MIT. [LICENSE](LICENSE) 참조.
