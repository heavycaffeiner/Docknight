# Docknight

[English README](README.md)

`docker compose` 스택을 관리하는 셀프 호스팅 웹 인터페이스입니다. 브라우저에서 스택을 배포하고,
시작하고, 멈추고, 편집하고, 상태를 지켜볼 수 있습니다. 컨테이너 안에서 셸을 열 수도 있습니다.

여기서 스택이란 compose 파일이 들어 있는 디렉터리를 말합니다. Docknight는 그 파일을 그 자리에서
편집하고 실제 `docker compose` CLI를 실행합니다. 그래서 Docknight를 꺼도 관리하던 스택은 터미널에서
그대로 동작합니다. 디스크 위의 내용에 대해 Docknight가 권위를 갖는 일은 없습니다.

## 무엇을 하는가

- 디렉터리를 훑어 스택을 찾고, `docker compose ls`가 보고하는 내용과 합칩니다. Docknight가 만들지
  않은 스택도 함께 나옵니다.
- YAML 편집기와 폼을 같이 띄워 `compose.yaml`과 `.env`를 편집합니다. 둘은 서로 동기화되고, 주석은
  보존됩니다.
- 배포, 시작, 중지, 재시작, 업데이트, down, 삭제를 실행하며 실제 명령 출력을 그대로 흘려보냅니다.
- 서비스별 상태와 헬스, 컨테이너 CPU와 메모리를 보여줍니다.
- 컨테이너 안에서 셸을 열고, 원하면 호스트 셸도 엽니다.
- 다른 Docknight 호스트의 스택을 한 화면에서 관리합니다.
- 관리자 계정 하나, 선택적 2단계 인증, 취소 가능한 세션.

## 시작하기 전에

- Docker Engine 20 이상과 Compose v2 플러그인이 있는 리눅스 호스트. Podman은 `podman-docker`로
  동작합니다.
- 그 호스트의 `/var/run/docker.sock` 접근 권한. 즉 root이거나 `docker` 그룹에 속한 사용자여야
  합니다.
- Docknight는 Docker 데몬 전체를 제어합니다. 로그인할 수 있는 사람은 호스트에서 무엇이든 실행할 수
  있으므로, 직접 네트워크 경계 안에 두고 5001 포트를 인터넷에 노출하지 마세요.

## 설치

이미지는 `ghcr.io/heavycaffeiner/docknight:latest`로 배포됩니다. `main`에 커밋할 때마다
`linux/amd64`와 `linux/arm64` 두 아키텍처로 빌드됩니다. 사용할 디렉터리 두 개를 만들고 기본 배포
파일을 넣습니다.

```
sudo mkdir -p /opt/docknight /opt/stacks
sudo curl -fsSL -o /opt/docknight/compose.yaml \
  https://raw.githubusercontent.com/heavycaffeiner/Docknight/main/docker/compose.yaml
cd /opt/docknight
sudo docker compose up -d
```

`http://<호스트 주소>:5001`을 열고 사용자 이름과 비밀번호를 정하면 끝입니다. 스택은 `/opt/stacks`
아래에 하나씩 디렉터리로 놓입니다.

**이 경로에 대한 규칙 하나.** `/opt/stacks`는 마운트 양쪽에서 같은 경로여야 합니다. compose 파일은
호스트 경로를 적고 Docker 데몬은 그 경로를 호스트 기준으로 해석합니다. 컨테이너 안에서 다른 경로에
마운트하면 관리 중인 모든 스택의 모든 바인드 마운트가 엉뚱한 곳을 가리키게 되고, 알려주는 오류도
없습니다. 양쪽을 같이 바꾸거나 그대로 두세요.

## `/opt/docknight` 백업

이 디렉터리에는 파일 네 개가 들어 있습니다. SQLite 데이터베이스와 `agent-key`, 즉 추가한 원격 호스트
비밀번호를 암호화하는 32바이트 난수입니다.

**`agent-key`는 복구할 수 없습니다.** 데이터베이스만 복원하면 원격 호스트들은 영구히 오프라인이 되고,
다시 추가하는 것 말고는 방법이 없습니다. 디렉터리 전체를 백업하거나 아예 하지 마세요.

Docknight는 그 네 파일만 읽고 쓰며 디렉터리 목록을 훑지 않습니다. 그러니 거기 둔 `compose.yaml`은
건드리지 않습니다.

## 업데이트

설정의 업데이트 탭에 **지금 업그레이드** 버튼이 있습니다. 새 이미지를 화면에 출력을 보여주며 받은
뒤, 잠깐 뜨는 헬퍼 컨테이너로 본체 컨테이너를 교체합니다. 그동안 몇 초 접속이 끊기고 브라우저는
알아서 다시 붙습니다. 실행 중인 스택은 건드리지 않습니다. 같은 화면의 **자동 업그레이드**를 켜면
업데이트 확인에서 새 릴리스를 찾는 즉시 이 과정을 실행합니다.

이 버튼은 Docker 소켓이 마운트되어 있고 컨테이너가 `docker compose`로 뜬 경우에만 동작합니다. 기본
배포 파일은 두 조건을 모두 만족합니다. 그렇지 않다면 호스트에서:

```
cd /opt/docknight
sudo docker compose pull
sudo docker compose up -d
```

소스에서 직접 빌드하려면:

```
git clone https://github.com/heavycaffeiner/Docknight.git
cd Docknight
docker build -f docker/Dockerfile -t docknight:1 .
```

## 로그인이 막혔을 때

컨테이너를 먼저 멈춥니다. Docknight가 데이터베이스를 잡고 있으면 이 도구는 실행을 거부합니다.

```
cd /opt/docknight
sudo docker compose stop
sudo docker compose run --rm docknight node scripts/reset-password.ts
sudo docker compose start
```

새 비밀번호를 물어보고, 2단계 인증을 해제하고, 모든 세션을 로그아웃시킵니다.

## 설정

`compose.yaml`에 환경 변수로 지정합니다. 각 항목에는 CLI 플래그도 있고, 키마다 CLI 플래그, 환경 변수,
기본값 순으로 우선합니다. 모르는 플래그는 치명적 오류이고, 모르는 환경 변수는 무시됩니다.

| 환경 변수                       | CLI                    | 기본값             | 역할                       |
|--------------------------------|------------------------|-------------------|----------------------------|
| `DOCKNIGHT_PORT`               | `--port`               | `5001`            | 수신 포트                   |
| `DOCKNIGHT_HOSTNAME`           | `--hostname`           | 없음, 전체 바인드   | 바인드할 주소                |
| `DOCKNIGHT_DATA_DIR`           | `--data-dir`           | `/app/data`       | 데이터베이스와 키 파일 위치   |
| `DOCKNIGHT_STACKS_DIR`         | `--stacks-dir`         | `/opt/stacks`     | 스택을 훑을 디렉터리         |
| `DOCKNIGHT_ENABLE_CONSOLE`     | `--enable-console`     | `false`           | 브라우저의 호스트 셸         |
| `DOCKNIGHT_SSL_KEY`            | `--ssl-key`            | 없음              | TLS 개인 키                 |
| `DOCKNIGHT_SSL_CERT`           | `--ssl-cert`           | 없음              | TLS 인증서                  |
| `DOCKNIGHT_SSL_KEY_PASSPHRASE` | `--ssl-key-passphrase` | 없음              | 키 암호                     |
| `DOCKNIGHT_LOG_LEVEL`          | `--log-level`          | `info`            | `debug`, `info`, `warn`, `error` |
| `PUID` / `PGID`                | 없음                   | 없음              | 기록한 파일의 소유자         |

스택 디렉터리에 Docknight가 쓴 파일을 본인 계정으로 편집하려면 `PUID`와 `PGID`를 둘 다 지정하세요.
TLS 옵션도 둘 다 지정하거나 둘 다 비워야 합니다. `DOCKNIGHT_DATA_DIR`와 `DOCKNIGHT_STACKS_DIR`는
겹칠 수 없습니다.

`DOCKNIGHT_ENABLE_CONSOLE`은 Docknight가 실행되는 계정, 보통 컨테이너 안의 root로 완전한 셸을
엽니다. Docker 소켓이 마운트된 상태이고, 샌드박스도 아니며 그럴 의도로 만들지도 않았습니다.

## 개발

Node 24 이상과 pnpm이 필요합니다. 백엔드는 Node의 타입 제거 기능으로 TypeScript 소스를 그대로
실행하므로 백엔드 빌드 단계가 없습니다. 지원 플랫폼은 리눅스입니다. 윈도우와 macOS는 WSL이나
컨테이너를 통해 동작할 것으로 보지만 검증하지 않았습니다.

```
pnpm install
pnpm build:frontend
pnpm dev:backend             # 5001 포트, 데이터와 스택은 .dev/ 아래
pnpm dev:frontend            # 5000 포트, /ws를 백엔드로 프록시
```

Docker 호스트 없이 화면만 작업할 때:

```
pnpm fixtures --scenario typical    # 5001 포트의 결정적 프로토콜 서버
pnpm dev:frontend                   # fixture / fixture-password-1 로 로그인
```

시나리오: `typical`, `empty`, `single-stack`, `dense`, `extreme`, `degraded`, `slow`.

```
pnpm verify                  # 타입 검사, 린트, 유닛 테스트
pnpm build:verify            # 브라우저 프로젝트가 대상으로 삼는 번들
pnpm test:layout             # 260개 셀: 그리드, 오버플로, 명암비, 타깃 크기
pnpm test:a11y               # 모든 화면, 두 테마에 axe-core 실행
```

여기서 스크린샷을 비교하는 검증은 없습니다. 외형은 리디자인을 견디는 기하와 명암비 규칙으로
검사합니다. 두 브라우저 프로젝트 모두 렌더링된 텍스트를 측정합니다. 애플리케이션이 지정하는 폰트는
번들에 들어 있지만, 제네릭 패밀리로 떨어지는 텍스트는 기기에 설치된 폰트로 측정되므로 그만큼 CI와
결과가 달라질 수 있습니다.

개발 빌드에서는 `Ctrl+Shift+G`가 뷰포트 위에 4픽셀 그리드를 그리고, `Ctrl+Shift+A`가 렌더링된 DOM에
레이아웃 감사기를 돌립니다.

## 구성

```
common/       프로토콜 타입, compose 헬퍼, 상수. 양쪽에서 가져다 씀
backend/      Node 프로세스 하나: HTTP, WebSocket, SQLite, docker 자식 프로세스
frontend/     Svelte 5 애플리케이션
docker/       이미지, 헬스체크, 기본 배포 파일
tools/        테마 생성, stylelint 규칙, 픽스처 백엔드, 레이아웃 감사기
docs/         이 구현이 따르는 명세 제안서
```

## 라이선스

MIT. [LICENSE](LICENSE) 참고.
