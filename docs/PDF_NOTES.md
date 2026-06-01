# PDF 笔记规则

PDF 笔记以 PDF 文件本身为准。Apple Books 数据库中的 PDF annotation 记录、计数和修改时间都不可信，不能作为判断 PDF 是否有笔记、是否需要同步、或笔记是否变化的依据。

## 同步依据

- PDF 是否有可同步笔记，应通过读取 PDF 文件中的 annotation 判断。
- PDF 是否发生变化，应通过源 PDF 文件状态判断，至少包括最后修改时间和文件大小。
- PDF 输出中的 `last_modified_at` 表示源 PDF 文件本身的最后修改时间，不表示 Apple Books 数据库里的 annotation 修改时间。

## 数据库边界

Apple Books 数据库可以用于发现书库条目、标题、作者和文件路径等库级元数据；这些信息不等同于 PDF 笔记状态。

对 EPUB，可以使用 Apple Books annotation 数据库读取划线、笔记、计数和修改时间。对 PDF，不可以。
