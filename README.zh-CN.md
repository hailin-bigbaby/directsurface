# DirectSurface

**面向专业浏览器工作台的 Canvas GUI 框架。** DirectSurface（npm 包名 `ds-ui`）使用 TypeScript，提供可停靠窗口、虚拟数据表格、图表、表单、浮层和主题。

[在线演示](https://hailin-bigbaby.github.io/directsurface/) · [快速开始](docs/getting-started.md) · [组件手册](docs/components/README.md) · [English README](README.md)

![DirectSurface 停靠工作区与数据表格](https://raw.githubusercontent.com/hailin-bigbaby/directsurface/main/docs/assets/canvas-workspace.png)

## 安装

```sh
npm install ds-ui
```

在 Vite + TypeScript 项目中放置一个铺满容器的 `<canvas id="app"></canvas>`，然后从包入口导入：

```ts
import {
  Application, ImGuiLightTheme, RenderPage,
  RenderStackPanel, RenderText, RenderWindow, loadDirectSurfaceFonts,
} from 'ds-ui'

await loadDirectSurfaceFonts()
const content = new RenderStackPanel({ padding: 24, spacing: 12 })
content.addChild(new RenderText('你好，DirectSurface！', { role: 'title' }))
const mainWindow = new RenderWindow({ title: '示例', chrome: 'none' })
mainWindow.setChildren([new RenderPage({ child: content })])
const host = Application.mount('#app').run(mainWindow, { theme: ImGuiLightTheme })
window.addEventListener('pagehide', () => host.dispose(), { once: true })
```

完整的 Canvas 尺寸设置和生命周期说明见[快速开始](docs/getting-started.md)。本包仅提供 ESM 入口。

## 体验演示

[在线演示](https://hailin-bigbaby.github.io/directsurface/)的 Workbench 展示项目筛选、指标与图表联动、任务编辑和日期选择；Canvas workspace 展示可停靠面板及 10,000 行本地生成数据的表格筛选。Controls 和 Data & charts 提供组件专题演示。

本版本不支持辅助技术无障碍访问；Canvas 控件未作为语义化 DOM 控件暴露。演示用户和任务数据均为虚构，任务数据在刷新后重置。

在本地运行演示：

```sh
git clone https://github.com/hailin-bigbaby/directsurface.git
cd directsurface
npm ci
npm run example:dev
```

[组件目录](docs/components.md)列出公开 API；[组件手册](docs/components/README.md)包含详细用法。参与开发见 [CONTRIBUTING.md](CONTRIBUTING.md)。
