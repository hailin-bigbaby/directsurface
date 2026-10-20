# DevTools

`RenderDevToolsWindow` 提供 Layout 与 Runtime 两个内置页面，可通过应用的 UI 服务打开。`RenderLayoutInspectorView` 和 `RenderRuntimeDiagnosticsView` 也可以独立嵌入；所有组件从 `directsurface` 根入口导入。

Layout 支持拾取元素、查看渲染树、对象属性、命中路径和 App Context。各页面可作为 tab 停靠、调整分区或浮动。Runtime 支持刷新、请求类型/来源/文本筛选、Requests/Hotspots 切换、堆栈采集控制、清空历史及快照检查。

## 布局与阅读

- DevTools 最小宽度为 360px。工具栏、筛选器与摘要使用框架主题，长摘要省略显示，完整内容可通过 tooltip 查看。
- Layout 默认只拆分 Render Tree 与 Object Inspector 两个区域，其余内容保留为 tab。内容宽度小于 760px 时上下排列，较宽时左右排列。默认比例给对象详情保留较多空间。
- 在用户手动改变分区比例、方向或停靠结构前，默认布局会随宽度切换；移动 tab 到其他分组、在组内重排或调整分区后会退出自动模式，后续窗口缩放保留其布局。普通 tab 激活和标题修改不退出自动模式。
- Runtime 在窄宽度下使用完整宽度的 Requests/Hotspots 与 Detail 页面，选择请求会切到详情；可点击 tab 返回列表。宽窗口同时显示列表和详情。
- Runtime 工具栏按空间换行，类型/来源使用下拉筛选，窄宽度下搜索框独占一行。详情区域独立滚动，筛选和选中状态在调整尺寸时保留。

## 数据一致性与快照

- Render Tree 缓存节点结构，`LayoutInspectorTreeNode.info` 在读取时取得当前几何和状态；不要将其当作冻结快照。导出 JSON 会复制这些信息，已导出的快照不会随界面改变。
- 拾取新的深层节点会补齐祖先展开路径，定位请求由 TreeView 在真实视窗完成布局后执行，因此首次打开、隐藏页恢复和结构更新时都能正确滚动。树结构更新会保留仍有效的手动展开分支，并移除失效 key。
- App Context 按 Registry 版本和原始值身份更新详情，不以截断的预览字符串判断值是否改变。原地修改上下文对象后，应再次调用 Registry 的 `set()` 通知更新。
- 快照和上下文预览不会执行 getter 或自定义 `toJSON()`；访问器显示 `[Getter]`、`[Setter]` 或 `[Getter/Setter]`，无效日期显示 `[Invalid Date]`，无法检查的对象显示 `[Uninspectable]`，循环引用显示 `[Circular]`。对象某个属性异常不会中断其他属性和整个快照。
- 诊断序列化限制对象深度、属性/数组数量和长字符串，适合排障而非业务数据备份；业务敏感信息仍须在接入层脱敏。

## Runtime 状态与刷新

默认 RuntimeHost 保留最近 80 条刷新请求，Hotspots 聚合这段历史。刷新按钮重新拉取当前数据，不是持续累积的长周期性能统计。

窄布局下选择请求或导出快照会切到 Detail；点击 Requests / Hotspots 返回列表。`debugState().compact` 表示是否使用窄布局，`activePane` 表示所选的 `requests` 或 `detail` 页面，`summaryText` 保留完整摘要。

`LayoutInspectorDebugState.selectedAppContextRevision` 是所选路径的可选上下文版本标识。需要冻结当前诊断信息时，调用 `RuntimeHost.createDiagnosticsSnapshot()`；`RenderRuntimeDiagnosticsSnapshotViewer` 可展示已保存的快照。

## 相关文档

- [运行时与生命周期](lifecycle.md)
- [框架容器与诊断组件](components/foundations-and-tools.md)
- [TreeView 滚动与延后定位](components/data/tree-view.md)
- [DockWorkspace 分区管理](components/navigation/dock-workspace.md)
