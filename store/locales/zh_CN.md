XClipper 是一个开源 Chrome 扩展，可将 X/Twitter 的串文、帖子和长文转换为干净的 Markdown，适用于 Obsidian、研究、AI 工作流和离线归档。

一键导出内容：

- 保存为 Markdown
- 复制 Markdown 到剪贴板
- 直接发送到 Obsidian
- 在 .md 文件旁本地下载图片

完全在你的浏览器中本地运行。无 API 密钥、无账号、无跟踪、无统计分析。

主要功能：

- 导出推文、串文、引用推文、嵌套串文以及长文 X Articles（原 Notes）
- 干净的 Markdown，可用于 Obsidian、Logseq、Notion、Hugo 以及其他基于 Markdown 的工作流
- 通过 obsidian:// URI 一键"添加到 Obsidian"
- 完整的 YAML frontmatter，包含作者、handle、日期、来源 URL、内容类型和互动数据
- 可选的 Obsidian 友好型 frontmatter：[[@handle]] 维基链接作者、Dataview 友好的元数据、合成的标题与描述
- 本地下载嵌入图片，避免链接失效
- 抓取链接卡片的标题、来源域名和预览图
- 抓取投票的选项、结果百分比以及投票总数/状态行
- 保留引用推文的结构与归属
- 导出单条推文或整条串文
- x.com 内嵌的导出按钮，加上工具栏弹窗与右键菜单
- 可自定义的文件名模板，支持 {date}、{handle}、{slug}、{type} 等占位符
- 可选的 Obsidian Vault 指定与 Vault 子文件夹
- 可选的 Markdown 与媒体下载子文件夹
- 多语言界面：英语、西班牙语、德语、法语、意大利语、俄语、日语、葡萄牙语（巴西）、简体中文、印地语、阿拉伯语、波斯语
- 浅色与深色模式

适合用于：

- Obsidian 与 PKM 工作流
- 研究与参考资料归档
- AI 提示词与 RAG 流水线
- 构建可搜索的第二大脑
- 离线保存 X 上的长文内容

当前限制：

- 视频与 GIF 不会作为可播放的媒体文件导出
- 如果 x.com 显著更改了页面结构，部分功能可能会失效
- 如果在 x.com 标签页已打开的情况下安装或更新扩展，请在导出前重新加载标签页 — 这是有意的，避免在未初始化的页面上出现静默失败

开源：
https://github.com/zendegani/xclipper

变更日志：
https://github.com/zendegani/xclipper/blob/main/CHANGELOG.md

XClipper 是独立的开源项目，与 X 或 Twitter 无关联。
