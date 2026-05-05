# spine-gif-test

一个用于提取、预览和导出 Spine 动画资源的本地 Web 工具。项目主要面向原神网页活动页面：输入活动 URL 后，服务端会抓取页面、解析 webpack 资源中的 Spine `.atlas` / `.json` / 贴图文件，并在浏览器中提供动画预览、选择打包下载以及 GIF/PNG 导出能力。

## 功能特性

- 从远程活动页面提取 Spine 资源。
- 支持从本地文件或文件夹加载 Spine 资源进行预览。
- 自动匹配 `.atlas`、`.json` 和贴图文件。
- 按资源分组展示预览卡片，并按贴图体积排序。
- 支持 Spine 3.8、4.0、4.1、4.2 runtime 候选加载。
- 识别动画、皮肤、PMA、推荐渲染尺寸等元信息。
- 支持预览动画、切换动画、切换皮肤、调试显示、逐帧定位。
- 支持单个资源导出 GIF 或当前帧 PNG。
- 支持选择多个资源并打包为 ZIP 下载。
- 内置活动链接列表 `activity-links.json`，可从界面快速选择常用活动页。
- 支持通过主题选择切换不同视觉主题。

## 环境要求

- Node.js 18 或更高版本。
- 本机需要可用的 Chromium 系浏览器。
  - Windows 下会优先尝试 Microsoft Edge。
  - 也可以通过环境变量 `EDGE_PATH` 或 `BROWSER_PATH` 指定浏览器路径。
- 运行时需要网络访问，用于抓取目标活动页面和加载部分 CDN 资源。

## 安装

```bash
npm install
```

项目已包含 `package-lock.json`，推荐使用 npm 安装依赖。

## 启动

```bash
npm start
```

默认服务地址：

```text
http://127.0.0.1:3770
```

如果需要修改监听地址或端口：

```bash
HOST=127.0.0.1 PORT=3880 npm start
```

Windows PowerShell：

```powershell
$env:HOST="127.0.0.1"
$env:PORT="3880"
npm start
```

## 使用方式

1. 启动服务后打开 `http://127.0.0.1:3770`。
2. 输入一个原神活动页面 URL，或点击活动列表选择内置链接。
3. 点击提取按钮，等待服务端完成页面抓取和 Spine 资源整理。
4. 在资源卡片中预览动画，可按需切换动画、皮肤或打开调试显示。
5. 勾选需要的资源后点击下载，可导出 ZIP 包。
6. 打开资源的全屏预览后，可导出 GIF 或当前帧 PNG。
7. 也可以通过本地文件夹按钮选择本地 `.atlas`、`.json`、贴图文件进行预览。

## 输出说明

ZIP 下载会将选中的资源整理到 `spine/` 目录下，并尽量使用清晰、唯一的文件名：

```text
spine/
  resource_name.atlas
  resource_name.json
  texture.png
```

如果在界面中双击资源名称并重命名，下载时会使用新的名称生成归档文件名。

GIF 文件名格式大致为：

```text
活动名-资源名.gif
```

当前帧 PNG 文件名格式大致为：

```text
活动名-资源名_000.png
```

## 接口概览

服务端由 `server.js` 提供以下接口：

- `GET /`：前端页面。
- `GET /api/health`：健康检查，返回当前会话数量。
- `POST /api/extract`：根据远程页面 URL 提取 Spine 资源。
- `POST /api/local-preview`：上传本地文件并生成预览会话。
- `POST /api/download`：按会话和选中资源生成 ZIP 下载。
- `GET /api/sessions/:sessionId/files/*`：读取当前会话缓存的资源文件。
- `GET /vendor/gif.worker.js`：代理 GIF 导出 worker 脚本。

会话资源保存在内存中，默认 30 分钟过期。

## 项目结构

```text
.
├── index.html              # 主界面、样式和 Spine runtime/CDN 引入
├── app.js                  # 前端交互、预览、导出和下载逻辑
├── server.js               # 本地 HTTP 服务、资源提取、会话缓存、ZIP 生成
├── extractor-core.js       # 注入页面环境的 Spine/webpack 资源解析核心
├── activity-links.json     # 内置活动链接列表
├── option_c_minimal.html   # 备用/实验页面
├── tools/
│   └── test-e20210715-prepage.js
├── package.json
└── package-lock.json
```

## 测试脚本

`tools/test-e20210715-prepage.js` 是一个针对示例活动页的 Playwright 检查脚本。需要先启动本地服务：

```bash
npm start
```

另开终端执行：

```bash
node tools/test-e20210715-prepage.js
```

也可以传入自定义应用地址和目标活动页：

```bash
node tools/test-e20210715-prepage.js http://127.0.0.1:3770 https://example.com/activity/index.html
```

## 注意事项

- 该工具依赖目标页面的前端打包结构，网页结构变化时可能需要调整 `extractor-core.js`。
- 部分活动页面可能没有 Spine 资源，或资源命名方式无法自动匹配。
- CDN 或目标站点不可访问时，提取、预览或 GIF 导出可能失败。
- `activity-links.json` 当前内容存在编码显示异常，但 URL 仍可作为提取入口使用。
- 项目用于本地资源分析和预览，请遵守相关网站与素材的使用条款。
