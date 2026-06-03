# 发版流程

本项目有两个发布面：

- npm package：发布 `absync` CLI。
- GitHub Release：发布 Obsidian plugin，由 Obsidian Community Plugins 同步 release assets。

两个发布面共享同一个版本号。发版前保持：

```text
package.json.version == manifest.json.version
versions.json[manifest.json.version] == manifest.json.minAppVersion
```

## 版本变更

1. 更新 `package.json` 的 `version`。
2. 更新 `package-lock.json` 中的 package version。
3. 更新 `manifest.json` 的 `version`。
4. 更新 `versions.json`，新增当前版本到 `manifest.json.minAppVersion` 的映射。
5. 运行：

```sh
npm run check
npm run pack:dry
```

6. 提交版本变更并合入 `main`。

不要手动提交 `lib/` 或 `plugin-dist/`。它们是构建产物。

## 发布 CLI 到 npm

在确认版本变更已合入 `main` 后：

```sh
git switch main
git pull --ff-only
npm publish
```

`prepublishOnly` 会自动运行 `npm run check`。如果想在发布前做一次完全干净的依赖安装，可以额外运行 `npm ci`，但日常发布不需要。

npm 包只发布 `package.json` 中 `files` 指定的内容：

- `lib/`
- `tools/`

发布后验证：

```sh
npm view apple-books-notes-sync version
npx apple-books-notes-sync --version
```

## 发布 Obsidian Plugin

在确认版本变更已合入 `main` 后：

1. 打开 GitHub Actions。
2. 运行 **Release** workflow。
3. Workflow 会执行：
   - `npm ci`
   - `npm run check`
   - 校验 `package.json`、`manifest.json`、`versions.json` 的版本关系
   - 校验 tag 不存在
   - 创建 GitHub release
4. GitHub release tag 等于 `manifest.json.version`。
5. Release assets 只上传 Obsidian 需要的文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`

不要把 `lib/`、`plugin-dist/`、`tools/` 作为源码提交。`tools/render_pdf_page.swift` 会随 npm CLI 包发布；plugin release assets 不包含 `tools/`。

## 推荐顺序

推荐顺序是先发布 npm，再运行 Obsidian plugin Release workflow。

原因：用户安装或更新 plugin 后，如果还没有对应版本的 CLI，设置页里的 CLI 检测和版本兼容提示会让用户卡在 npm 发布之前。

## 首次提交到 Obsidian Community Plugins

仓库中需要准备：

- `README.md`
- `LICENSE`
- `manifest.json`
- `versions.json`
- `styles.css`
- `.github/workflows/release.yml`
- GitHub release，且 release assets 包含 `main.js`、`manifest.json`、`styles.css`

首次提交到 Obsidian 社区插件列表后，后续更新依赖 GitHub release 和 `versions.json`。

## 检查清单

发版前确认：

- `package.json.version` 已更新。
- `package-lock.json` 已更新。
- `manifest.json.version` 已更新。
- `versions.json` 包含当前版本。
- `npm run check` 通过。
- `npm run pack:dry` 输出内容符合预期。
- `npm view apple-books-notes-sync version` 还不是要发布的版本。
- GitHub 上不存在同名 release/tag。
