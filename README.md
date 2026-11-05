# SJTU人工智能基础课程题库练习

这是一个完全离线的 AI 课程题库练习网页，题目从同目录中的 7 份 PDF 自动生成并加载。

您可以访问 <https://aicourse.sj-tu.com> 直接开始练习。

**注意：如果更换浏览器、使用隐私模式，或清除浏览器站点数据，练习记录会丢失，因为数据保存在当前浏览器的 `localStorage` 中。**

## 功能

- 顺序练习：严格按 PDF 文件名和 PDF 内题目顺序练习，自动跳过已练过的题目；全部练完后入口会禁用。
- 章节练习：首页可进入每个章节单独练习；完成后会显示本章完成提示与可展开的章节讨论区。
- 错题练习：只显示错题本中的题目；在错题模式答对后会自动移出错题本。
- 模拟测试：在 `/practice` 自定义考试范围和各题型数量，随机组卷、跳题、交卷、自动判分，并提供逐题解析。
- 选择题 / 判断题：选项作答后自动判分，答错会自动加入错题本。
- 填空题 / 简答题 / 计算题：点击“显示答案”后可手动自评；默认记为正确，也可改判为错误。
- 上一题 / 下一题：选择题和判断题点选即判定；右方向键或左滑可跳过当前题，左方向键或右滑会按题库顺序回看上一题。顺序练习与章节练习前进时会自动略过已完成题，回看已完成题不能重复作答或计分。
- 手动修正：提交后可以手动加入或移出错题本；错题练习中也可直接删除题目。
- 已学进度：首页“题库概览”显示总进度及每份 PDF 的已学题数。
- 章节练习：首页每一章都可直接进入该章的顺序练习，进度、错题和作答记录与全题库练习共用。
- 深色模式：右上角可切换浅色 / 深色主题，偏好会自动保存。
- 查看原题：练习页可打开对应 PDF 页进行核对。
- 课程讨论：首页固定同步仓库的 [Discussion #7](https://github.com/tombirdQAQ/SJTU-AI-Course/discussions/7)；每章练习完成后可展开该章专属讨论。

## 本地使用

运行命令：
```bash
git clone https://github.com/tombirdQAQ/SJTU-AI-Course.git
```

然后双击 `index.html`，或用浏览器打开即可。

### 如果您使用本项目的目的仅为练习，您可以忽略以下内容

## 本地服务

如果你希望通过本地 HTTP 服务访问，运行：

```powershell
.\start-local.ps1
```

然后访问 `http://127.0.0.1:8788`。

这个服务支持并发静态文件访问和 `/practice` 路由。每个用户的练习进度仍然保存在各自浏览器中，不会互相看到，也不会跨设备同步。

## Cloudflare Pages 部署

推荐的部署方式是先把代码推送到 GitHub，再在 Cloudflare Pages 控制台连接该仓库。以后每次推送到生产分支，Cloudflare 会自动拉取代码、执行构建并发布。

一次性准备步骤如下：

1. 在 GitHub 创建仓库，并把本项目推送上去。
2. 打开 Cloudflare 控制台，进入 Workers & Pages，创建 Pages 项目。
3. 选择 Connect to Git，授权 GitHub，然后选择这个仓库。
4. 构建设置填写：
   - Framework preset: None
   - Production branch: main
   - Build command: npm run build
   - Build output directory: dist
   - Root directory: 留空
   - Framework preset: None
   - Production branch: main
   - Build command: npm run build
   - Build output directory: dist
   - Root directory: 留空
5. 保存并部署。以后推送到 `main` 分支会自动触发 Cloudflare Pages 重新构建和发布。

本地验证构建：

```powershell
npm run build
```

构建产物会生成到 `dist/`。Cloudflare Pages 会使用 `_redirects` 将 `/practice` 重写到 `practice.html`，并使用 `_headers` 设置基础安全头和缓存策略。

也可以通过 `start-public.ps1` 使用 Tunnel 发布。

## 重新生成题库

当 PDF 内容发生变化时，在本目录运行：

```powershell
python .\scripts\build_questions.py
```

脚本依赖 `pypdf`，生成的 `questions.js` 可供离线网页直接读取。

## 许可证

代码部分采用 MIT License，完整许可见 [LICENSE](LICENSE)。

题库文本、解析文案、说明文字等内容采用 Creative Commons Attribution-ShareAlike 4.0 International，完整许可见 [LICENSE-CONTENT](LICENSE-CONTENT)。

如果你希望将项目公开发布或二次分发，请同时保留对应的版权声明和许可证文本。

