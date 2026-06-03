# Pull Request 流程

所有仓库改动都使用功能分支。不要直接在 `main` 上提交。

## 分支

从最新的 `main` 开始：

```sh
git switch main
git pull --ff-only
git switch -c <type>/<short-topic>
```

分支名应简短描述这次工作，例如：

```sh
git switch -c docs/project-guidance
git switch -c fix/pdf-overlay-content
```

## Commit 信息

这个仓库最近的提交历史主要使用：

```text
type: summary
```

规则：

- `type` 使用小写。
- 优先沿用 `feat`、`fix`、`refactor`、`test`。
- 纯文档改动使用 `docs`。
- 非用户可见的维护类工作使用 `chore`。
- `summary` 应直接描述这次改动本身，优先使用简短英文动词短语。

示例：

```text
feat: add ribbon sync action
fix: preserve PDF content when overlaying markers
docs: add project maintenance docs
```

## 校验

根据改动风险选择校验范围。代码改动优先跑完整检查：

```sh
npm run check
```

也可以按需要使用更窄的检查：

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

如果改动涉及 plugin 行为，并且需要在本地 Obsidian 中验证，安装开发版 plugin：

```sh
npm run install:plugin
```

如果改动涉及 CLI 打包或 CLI/plugin 集成，按需测试本地全局 CLI 安装：

```sh
npm run install:local
```

## 推送

推送当前分支：

```sh
git push -u origin <branch>
```

## 创建 PR

使用 GitHub CLI。默认 `gh` 已经用正确身份登录：

```sh
gh pr create --base main --head <branch> --title "<title>" --body "<body>"
```

PR 标题尽量接近主要 commit 的格式，例如：

```sh
gh pr create --base main --head docs/project-guidance --title "docs: add project guidance" --body "Adds AGENTS.md routing guidance and contributor docs."
```

创建后检查 PR：

```sh
gh pr view --web
gh pr checks
```
