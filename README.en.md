# App Manager (앱 관리 프로젝트)

[한국어](README.md) · **English**

A personal launcher that gathers the apps and deliverables you've built into **one screen of cards** and opens each one with a single click.
Web URLs, Chrome apps, Windows programs, WSL commands, static sites, and even deliverables like videos and documents — every one of them is a card.

> The interface is in Korean. This README explains every screen element you need.

![App Manager dashboard](docs/images/dashboard.png)

> First time? Follow the step-by-step guide → **[Setup Guide](docs/SETUP.en.md)**

## Why?

When you build apps one after another, the results scatter: deployed URLs live in bookmarks, local builds in desktop shortcuts, contest videos in your Downloads folder, and server apps only as terminal commands.

App Manager collects them as **cards with thumbnails** in one place.

- Click a card to run it. Each card decides how it opens.
- Multiple ways to run one project (deployed vs. local, final video vs. YouTube vs. output folder) live on **a single card**.
- If you use Claude Code, just say **"앱 관리 프로젝트에 등록해줘"** ("register this in App Manager") inside a project and a card is created for you.

## Try it first

You can see the screen with sample cards before installing. In a **WSL (Ubuntu) terminal**:

```bash
cd ~
git clone https://github.com/GojoSuperman/app-manager.git
cd app-manager
npm install
npm run demo
```

A screen with 8 sample cards opens in your browser (`http://127.0.0.1:4799`). The samples live in a temporary folder and never mix with your real data. Close the browser window and it shuts down shortly after.

## Install

> ⚠️ Run every command in a **WSL (Ubuntu) terminal**, not Windows PowerShell.

```bash
cd ~
git clone https://github.com/GojoSuperman/app-manager.git
cd app-manager
bash scripts/setup.sh
```

`setup.sh` does the following and is safe to run again:

1. Checks for Node.js 20+
2. Installs dependencies (`npm install`)
3. Creates the data folder (`~/.config/my-app-launcher`)
4. Installs the **registration skill** for Claude Code (`~/.claude/skills/register-to-launcher`)
5. Creates an **"앱 관리 프로젝트"** (App Manager) icon on your desktop

Then double-click the desktop icon. Detailed steps and troubleshooting are in the [Setup Guide](docs/SETUP.en.md).

## Usage

### Running a card

- Click **▶ 실행** (Run) or the card itself.
- A card with several launches shows a **[▶ default │▾]** button. Pick another launch with ▾.

![Run menu](docs/images/run-menu.png)

### Three ways to create cards

| Button / tool | When |
|---|---|
| **＋ 앱 추가** (Add app) | Enter it yourself. Picking a project folder also links the source folder |
| **⬇ GitHub에서 가져오기** (Import from GitHub) | Pick from your GitHub repositories in one go (requires `gh` login) |
| **Registration skill** (Claude Code) | Tell Claude Code "앱 관리 프로젝트에 등록해줘" in a project folder — it inspects the project and fills in how to run it |

When importing from GitHub, a repository with a **website URL** becomes a ready-to-run card. Otherwise it becomes a **"확인 필요"** (needs review) card; fill in how to run it later with ✎ (edit) or the registration skill.

### Six launch types

| Launch type | Opens | Example |
|---|---|---|
| 웹 주소 (Web URL) | The URL in your default browser | A deployed web app |
| 크롬 앱 (Chrome app) | A Chrome-installed web app (PWA) in its own window | Installed web app |
| Windows 실행 (Windows) | A Windows program, `.bat`, `.vbs`, `.ps1` | Games, desktop apps |
| WSL 명령 (WSL command) | A command in WSL (new terminal window or hidden) | `npm start` |
| 로컬 웹 (Local web) | A no-build `index.html` folder, served by the launcher | Static site |
| 파일 열기 (Open file) | Videos, documents, folders in their default Windows program | Contest video, submission files |

For Open file, type the path or use **📄 파일 선택 / 📁 폴더 선택** (pick file / folder) with shortcuts to the project, `~/projects`, Downloads, Desktop and Documents.

![Edit dialog](docs/images/edit-dialog.png)

### Organizing

- **Category tabs**: drop a card on a tab to move it there. Create a tab with the ＋ at the end; drag tabs to reorder.
- **Card order**: drag cards to reorder.
- **Thumbnails**: upload, paste (Ctrl+V) or drop an image, then adjust position, zoom, rotation and flip in the editor. Web cards can also be **auto-captured** (requires Chrome on Windows).
- The 📁 button opens the source project folder in Explorer.

## Claude Code registration skill

`setup.sh` installs it to `${CLAUDE_CONFIG_DIR:-~/.claude}/skills/register-to-launcher`. In a project folder, tell Claude Code:

> 앱 관리 프로젝트에 등록해줘

The skill only **reads** the README, `package.json`, run scripts and deploy settings to decide how to run the project, shows you a draft card, and registers it **only after you confirm**. Registering the same project again updates its card instead of creating a duplicate.

If you use several Claude Code config folders, install for each: `CLAUDE_CONFIG_DIR=~/.claude-other bash scripts/setup.sh`

## Requirements

| Requirement | Why |
|---|---|
| **Windows 10/11 + WSL2** | Launches Windows programs and the browser from WSL → **macOS / native Linux not supported** |
| **Node.js 20+** inside WSL | Runs the server |
| (optional) **Chrome** on Windows | Thumbnail auto-capture, Chrome apps |
| (optional) **GitHub CLI** (`gh`), logged in | Import from GitHub |
| (optional) **Claude Code** | Registration skill |

## Where is my data?

Cards are stored outside the repository in **`~/.config/my-app-launcher/`**. Deleting or updating the repository keeps your cards.

| File | Contents |
|---|---|
| `apps.json` | Card list (`apps.json.bak` is the previous version) |
| `thumbs/` | Thumbnail images |
| `order.json` · `tab-order.json` | Card order · category tab order |
| `categories.json` · `labels.json` | Your own category tabs · launch labels |
| `trash/` | Deleted cards (for undo) |

Set `MY_APP_LAUNCHER_HOME` to use another folder.

## How it works & security

- A browser alone can't start PC programs, so a **small local server inside WSL** (Express) does it. The UI lives at `http://127.0.0.1:4790`.
- The server listens on **127.0.0.1 only**. Every request is checked against a token embedded in the page and its Origin, so other websites can't send launch commands.
- Local web apps are served from a different port (`4791`), so those pages can't reach the launcher's launch API.
- The launcher **never modifies your project files**. The file browser only reads names.
- Closing the dashboard window shuts the server down after 10 seconds (`MY_APP_LAUNCHER_AUTO_SHUTDOWN=0` keeps it running).

## Updating

```bash
cd ~/app-manager
git pull
npm install
```

If server code changed, click **런처 종료** (quit launcher) and reopen from the desktop icon. For screen-only changes, Ctrl+Shift+R in the browser is enough. Re-run `bash scripts/setup.sh` to update the registration skill too.

## Tests

```bash
npm test
```

## License

[MIT](LICENSE)
