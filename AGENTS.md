这个仓库是 `apple-books-notes-sync` 的开源项目仓库，对应 <https://github.com/Moskize91/apple-books-notes-sync>。

项目主体是一个 macOS 桌面工具，用于把 Apple Books 中的划线、笔记和 PDF 标注同步到 Obsidian vault 中的 Markdown 文件。它同时提供 Obsidian desktop plugin 和 `absync` CLI 两个入口；当前架构中，plugin 负责 Obsidian 内的设置和交互，实际同步工作由 plugin 启动 `absync` 子进程完成。

# 现状总览

- 当前工作方式是“一个仓库、两个发布面”：`src/plugin/main.ts` 是 Obsidian plugin 入口，`src/cli.ts` 是 `absync` CLI 入口，二者共享 `src/lib/` 中的同步、渲染、状态和 Apple Books 读取逻辑。
- CLI 是实际执行引擎，负责读取 Apple Books 数据、生成同步计划、写入 Markdown 和 PDF 图片资产。
- Obsidian plugin 是 vault-scoped UI 和调度层，负责保存插件设置、检查 CLI 路径、启动 CLI 子进程、展示 Notice、状态栏进度和失败详情。
- 用户提到“项目”或“仓库”时，默认指当前仓库根目录，不存在额外的 `project/` 子仓库或 submodule 工作区。
- 构建产物不作为源码维护：CLI 输出到 `lib/`，plugin release staging 输出到 `plugin-dist/`。
- 本项目是 macOS / Obsidian desktop 场景；移动端 Obsidian 不支持。

# 文档原则

- 文档入口是 AI 路由表。它的职责不是摘要下层文档，而是用问题域和触发条件把 AI 路由到合适的文档。
- 这个原则适用于整个仓库的所有文档。上层文档负责路由，下层文档负责展开；文档之间应通过引用组织信息，而不是重复彼此内容。
- 所有文档都应保持简洁，只写和业务有关、AI 不会天然知道的信息；不要为了阅读体验补写常识，也不要把细节不断堆回入口文档。

# AI 路由表

- `docs/ARCHITECTURE.md`: 涉及项目整体结构、CLI 与 Obsidian plugin 的关系、构建产物或运行边界时，阅读此文。
- `docs/PULL_REQUEST_WORKFLOW.md`: 进行 Git 操作或 GitHub 相关操作，如提交代码、推分支、提 PR、检查 PR 状态前阅读此文。
- `README.md` 和 `README.zh-CN.md`: 涉及用户安装、CLI 命令、首次运行、开发构建入口或英文公开说明时，阅读此文。
