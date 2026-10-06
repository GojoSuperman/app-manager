# 설치 가이드

**한국어** · [English](SETUP.en.md)

**WSL2 확인 → Node 준비 → 받기 → `setup.sh` 한 번 → 실행** 순서입니다. 명령은 모두 **WSL(우분투) 터미널**에 입력합니다.

---

## 0. 준비물

| 필요한 것 | 이유 | 없으면 |
|---|---|---|
| **Windows 10/11 + WSL2** | WSL에서 Windows 프로그램·브라우저를 띄움 (맥·일반 리눅스는 안 됨) | 1번에서 설치 |
| WSL 안의 **Node.js 20 이상** | 서버 실행 | 2번에서 설치 |
| (선택) Windows의 **Chrome** | 썸네일 자동 캡처, 크롬 앱 실행 | 없어도 나머지 기능은 동작 |
| (선택) **GitHub CLI** (`gh`) 로그인 | ⬇ GitHub에서 가져오기 | 5번 |
| (선택) **Claude Code** | 등록 스킬("앱 관리 프로젝트에 등록해줘") | 6번 |

## 1. WSL2 확인

Windows **PowerShell**에서:

```powershell
wsl -l -v
```

`VERSION`이 `2`인 배포판(예: Ubuntu)이 있으면 됩니다. 없으면 **관리자 PowerShell**에서 `wsl --install` → 재부팅 → 우분투를 처음 열어 사용자 이름과 비밀번호를 만드세요.

이제부터는 **우분투 터미널**(시작 메뉴 → Ubuntu)에서 합니다.

## 2. Node.js 20 이상

```bash
node -v
```

`v20` 이상이면 다음으로 넘어갑니다. 없거나 낮으면 nvm으로 설치합니다.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# 터미널을 닫았다 다시 연 뒤
nvm install --lts
```

## 3. 받기와 설치

```bash
cd ~
git clone https://github.com/GojoSuperman/app-manager.git
cd app-manager
bash scripts/setup.sh
```

> ⚠️ **PowerShell에서 clone하지 마세요.** `.sh` 파일이 Windows 줄바꿈(CRLF)으로 저장돼 `set: pipefail: invalid option name` 오류가 납니다. 이미 그랬다면 폴더를 지우고 우분투 터미널에서 다시 clone하세요.

`setup.sh`가 하는 일:

| 단계 | 내용 |
|---|---|
| ① | Node 버전 확인 |
| ② | `npm install` |
| ③ | 데이터 폴더 `~/.config/my-app-launcher` 만들기, 런처 위치를 `config.json`에 기록 |
| ④ | 등록 스킬을 `${CLAUDE_CONFIG_DIR:-~/.claude}/skills/register-to-launcher`에 복사 |
| ⑤ | 바탕화면에 **"앱 관리 프로젝트"** 아이콘 만들기 |

건너뛰고 싶은 단계가 있으면 `SKIP_NPM=1`, `SKIP_SKILL=1`, `SKIP_SHORTCUT=1`을 앞에 붙이세요.

## 4. 실행

바탕화면의 **"앱 관리 프로젝트"** 아이콘을 더블클릭하세요.

- 서버가 창 없이 뒤에서 켜지고 브라우저에 `http://127.0.0.1:4790`이 열립니다.
- 화면 아래 **서버 콘솔**에 서버 기록이 보입니다.
- 브라우저 창을 닫으면 10초 뒤 서버가 스스로 꺼집니다. 위쪽 **런처 종료** 버튼으로 바로 끌 수도 있습니다.

처음에는 카드가 없습니다. **＋ 앱 추가**, **⬇ GitHub에서 가져오기**, 또는 등록 스킬로 카드를 만드세요.

> 아이콘 없이 켜려면: `cd ~/app-manager && bash scripts/launch.sh`

## 5. (선택) GitHub에서 가져오기

```bash
sudo apt install gh    # 또는 https://cli.github.com 의 안내
gh auth login
```

로그인한 뒤 화면 위쪽 **⬇ GitHub에서 가져오기**를 누르면 내 저장소 목록이 체크 목록으로 뜹니다.

- 웹사이트 주소가 있고 아직 카드가 없는 저장소는 미리 체크돼 있습니다.
- `~/projects`에 내려받은 폴더가 있으면 원본 폴더로 연결됩니다. 다른 폴더를 쓰면 `MY_APP_LAUNCHER_PROJECTS_ROOT`로 바꾸세요.
- 웹사이트 주소가 없는 저장소는 **"확인 필요"** 카드가 됩니다. ✎ 수정에서 실행 방법을 채우세요.

## 6. (선택) Claude Code 등록 스킬

3번의 `setup.sh`가 이미 설치했습니다. 프로젝트 폴더에서 Claude Code를 열고 이렇게 말하세요.

> 앱 관리 프로젝트에 등록해줘

Claude Code 설정 폴더를 여러 개 쓴다면(`CLAUDE_CONFIG_DIR`), 그 폴더마다 한 번씩 실행하세요.

```bash
CLAUDE_CONFIG_DIR=~/.claude-다른계정 SKIP_NPM=1 SKIP_SHORTCUT=1 bash scripts/setup.sh
```

---

## 막혔을 때

| 증상 | 해결 |
|---|---|
| `set: pipefail: invalid option name` | PowerShell에서 clone한 경우입니다. 우분투 터미널에서 다시 clone하세요 |
| "포트 4790을 다른 프로그램이 쓰고 있어요" | 그 프로그램을 끄거나 `MY_APP_LAUNCHER_PORT=4800 bash scripts/launch.sh`처럼 다른 포트로 |
| "Windows 연동(WSL interop)이 꺼져 있어…" | `/etc/wsl.conf`의 `[interop] enabled=false`를 지우고 PowerShell에서 `wsl --shutdown` 후 다시 열기 |
| 자동 캡처·크롬 앱이 "크롬을 찾지 못했어요" | 크롬을 설치하거나, `~/.config/my-app-launcher/config.json`에 `"chromeDir": "C:\\…\\Chrome\\Application"`을 적기 |
| 업데이트했는데 새 기능이 안 보임 | 서버 코드가 바뀐 경우 **런처 종료** 후 아이콘으로 다시 켜기. 화면만 바뀐 경우 Ctrl+Shift+R |
| 다운로드 폴더 찾아보기가 1~2초 걸림 | 정상입니다. WSL이 직접 못 읽는 Windows 폴더는 Windows로 목록을 대신 읽어서 조금 느립니다 |

## 지우기

1. 바탕화면의 "앱 관리 프로젝트" 아이콘 삭제
2. `rm -r ~/app-manager` (프로그램)
3. 카드까지 지우려면 `rm -r ~/.config/my-app-launcher`
4. 스킬까지 지우려면 `rm -r ~/.claude/skills/register-to-launcher`
