# 整体结构

这个仓库通过两个入口发布同一个产品：

- `absync` 命令行工具。
- Apple Books Notes Sync Obsidian 桌面插件。

运行时二者不是平等关系。CLI 是实际执行引擎；Obsidian plugin 是 vault 级别的 UI 和调度层，通过子进程启动 CLI。

## 源码布局

- `src/cli.ts` 是 CLI 入口，负责注册 `src/commands/` 下的命令。
- `src/plugin/main.ts` 是 Obsidian plugin 入口，负责插件设置页、命令、左侧 ribbon 按钮、状态栏进度和 CLI 子进程调用。
- `src/lib/` 放共享领域代码，包括 Apple Books 数据读取、同步计划、Markdown 渲染、PDF 处理、vault 发现、插件设置、同步状态和运行时配置。
- `manifest.json` 和可选的 `styles.css` 是 plugin 发布输入。
- `tools/render_pdf_page.swift` 会被复制到 plugin 发布暂存目录，供本地开发和手动安装场景使用。Obsidian Community Plugins 的 GitHub release assets 只上传 `main.js`、`manifest.json`、`styles.css`。
- PDF 笔记的可信来源和同步规则见 `docs/internal/PDF_NOTES.md`。

## 构建产物

- CLI 构建到 `lib/cli.js`；`package.json` 把它暴露为 `absync` binary。
- Plugin 构建到 `plugin-dist/main.js`；`npm run prepare:plugin` 还会暂存 `manifest.json`、可选的 `styles.css` 和本地/手动安装用的 plugin 工具文件。
- `lib/` 和 `plugin-dist/` 是构建产物，不是源码维护入口。

同时更新两个发布面时，使用：

```sh
npm run build
```

## 运行关系

CLI 拥有同步执行职责。它读取 Apple Books 数据，解析目标 Obsidian vault，生成同步计划，写入 Markdown 文件，写入受管理的 PDF 图片资产，并更新同步状态。

Obsidian plugin 不在 Obsidian 进程内执行同步逻辑。它保存 vault 本地插件设置，校验用户配置的 CLI 路径，然后以子进程方式运行 `absync`。这样长时间同步任务不会阻塞 Obsidian 的 renderer 进程。

对于长时间运行的 sync，plugin 会要求 CLI 以 JSON lines 形式输出进度，并把进度展示在 Obsidian 状态栏中。Notice 只用于开始和成功反馈；失败时通过 dialog 展示捕获到的命令输出。

## 设置边界

Plugin 设置保存在每个 vault 的 Obsidian 插件数据中。CLI 通过 Obsidian 全局 app data 发现 vault，并读取被选中 vault 内的 plugin 设置。

Plugin 要求设置中存在明确的 CLI 路径。设置页提供检测和测试操作；普通 plugin 命令在路径缺失或不可用时应尽早失败，并引导用户到设置页处理。

## 本地开发

- `npm run install:local` 构建两个发布面，并从当前 checkout 全局安装 CLI。
- `npm run install:plugin` 构建 plugin 暂存目录，并复制到 `OBSIDIAN_DEV_VAULT` 指向的 vault。
- `npm run check` 依次执行 lint、typecheck、tests 和 build。
