# Setup Guide

[한국어](SETUP.ko.md) · **English**

**Check WSL2 → prepare Node → clone → run `setup.sh` once → launch.** Run every command in a **WSL (Ubuntu) terminal**.

> The interface is in Korean. Button names are given with an English translation in parentheses.

---

## 0. Requirements

| Requirement | Why | If missing |
|---|---|---|
| **Windows 10/11 + WSL2** | Launches Windows programs and the browser from WSL (no macOS / native Linux) | Step 1 |
| **Node.js 20+** inside WSL | Runs the server | Step 2 |
| (optional) **Chrome** on Windows | Thumbnail auto-capture, Chrome apps | Everything else still works |
| (optional) **GitHub CLI** (`gh`), logged in | ⬇ Import from GitHub | Step 5 |
| (optional) **Claude Code** | Registration skill | Step 6 |

## 1. Check WSL2

In Windows **PowerShell**:

```powershell
wsl -l -v
```

You need a distro (e.g. Ubuntu) with `VERSION` `2`. If not, run `wsl --install` in an **administrator PowerShell**, reboot, and open Ubuntu once to create a user name and password.

From here on, use the **Ubuntu terminal** (Start menu → Ubuntu).

## 2. Node.js 20+

```bash
node -v
```

If it prints `v20` or higher, move on. Otherwise install with nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# close and reopen the terminal, then
nvm install --lts
```

## 3. Clone and install

```bash
cd ~
git clone https://github.com/GojoSuperman/app-manager.git
cd app-manager
bash scripts/setup.sh
```

> ⚠️ **Don't clone from PowerShell.** The `.sh` files get Windows line endings (CRLF) and fail with `set: pipefail: invalid option name`. If that happened, delete the folder and clone again from the Ubuntu terminal.

What `setup.sh` does:

| Step | What |
|---|---|
| ① | Checks the Node version |
| ② | `npm install` |
| ③ | Creates the data folder `~/.config/my-app-launcher` and records the launcher location in `config.json` |
| ④ | Copies the registration skill to `${CLAUDE_CONFIG_DIR:-~/.claude}/skills/register-to-launcher` |
| ⑤ | Creates an **"앱 관리 프로젝트"** (App Manager) icon on the desktop |

Prefix `SKIP_NPM=1`, `SKIP_SKILL=1` or `SKIP_SHORTCUT=1` to skip a step.

## 4. Launch

Double-click the **"앱 관리 프로젝트"** icon on your desktop.

- The server starts in the background (no window) and your browser opens `http://127.0.0.1:4790`.
- The **server console** at the bottom shows the server log.
- Closing the browser window shuts the server down after 10 seconds. The **런처 종료** (quit launcher) button at the top stops it right away.

There are no cards at first. Create some with **＋ 앱 추가** (Add app), **⬇ GitHub에서 가져오기** (Import from GitHub), or the registration skill.

> To start without the icon: `cd ~/app-manager && bash scripts/launch.sh`

## 5. (optional) Import from GitHub

```bash
sudo apt install gh    # or follow https://cli.github.com
gh auth login
```

After logging in, click **⬇ GitHub에서 가져오기** at the top to get a checklist of your repositories.

- Repositories with a website URL and no card yet are pre-checked.
- If a clone exists in `~/projects`, it's linked as the source folder. Use `MY_APP_LAUNCHER_PROJECTS_ROOT` for a different folder.
- Repositories without a website URL become **"확인 필요"** (needs review) cards. Fill in how to run them with ✎ (edit).

## 6. (optional) Claude Code registration skill

`setup.sh` in step 3 already installed it. Open Claude Code in a project folder and say:

> 앱 관리 프로젝트에 등록해줘

("Register this in App Manager.") If you use several Claude Code config folders (`CLAUDE_CONFIG_DIR`), run once per folder:

```bash
CLAUDE_CONFIG_DIR=~/.claude-other SKIP_NPM=1 SKIP_SHORTCUT=1 bash scripts/setup.sh
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `set: pipefail: invalid option name` | You cloned from PowerShell. Clone again from the Ubuntu terminal |
| "포트 4790을 다른 프로그램이 쓰고 있어요" (port 4790 in use) | Stop that program, or use another port: `MY_APP_LAUNCHER_PORT=4800 bash scripts/launch.sh` |
| "Windows 연동(WSL interop)이 꺼져 있어…" (WSL interop is off) | Remove `[interop] enabled=false` from `/etc/wsl.conf`, then `wsl --shutdown` in PowerShell and reopen |
| Auto-capture / Chrome app says "크롬을 찾지 못했어요" (Chrome not found) | Install Chrome, or add `"chromeDir": "C:\\…\\Chrome\\Application"` to `~/.config/my-app-launcher/config.json` |
| New features don't show after updating | If server code changed, quit the launcher and reopen from the icon. For screen-only changes, Ctrl+Shift+R |
| Browsing the Downloads folder takes 1–2 s | Expected. Windows folders WSL can't read directly are listed through Windows instead |

## Uninstall

1. Delete the "앱 관리 프로젝트" icon from the desktop
2. `rm -r ~/app-manager` (the program)
3. To delete your cards too: `rm -r ~/.config/my-app-launcher`
4. To delete the skill too: `rm -r ~/.claude/skills/register-to-launcher`
