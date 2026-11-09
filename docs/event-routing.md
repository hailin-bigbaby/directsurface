# 事件路由

事件路由负责把浏览器输入转换为框架内的组件事件。它连接命中测试、焦点、手势和组件交互。

## 输入来源

常见输入来源包括：

- pointer down / move / up。
- wheel。
- keyboard。
- composition 输入。
- paste。
- context menu。

不同组件只处理自己关心的事件。

## 指针事件：注册和取消监听

所有 `RenderObject`（控件、容器和 `RenderWindow`）均支持 `addPointerEventListener` / `removePointerEventListener`。鼠标和触摸沿用框架统一的指针输入，不需要覆盖控件原有的 `onPointerDown` 等方法。

```ts
import { RenderButton, RenderWindow, type PointerEventListener } from 'directsurface'

const window = new RenderWindow({ title: '编辑', width: 420, height: 260 })
const button = new RenderButton({ label: '保存', onClick: () => save() })
window.addChild(button)

const offCapture = window.addPointerEventListener('pointerdown', event => {
  console.log('窗口捕获', event.target, event.position)
}, { capture: true })

const offTarget = button.addPointerEventListener('pointerdown', event => {
  console.log('按钮目标', event.localPosition)
})

const onBubble: PointerEventListener = event => {
  console.log('窗口冒泡', event.currentTarget, event.button)
}
window.addPointerEventListener('pointerdown', onBubble)

// 在页面不再需要这些监听时取消：
offCapture()
offTarget()
window.removePointerEventListener('pointerdown', onBubble)
```

### 支持的事件

| 类型 | 含义 |
| --- | --- |
| `pointerdown` / `pointermove` / `pointerup` / `pointercancel` | 框架原有的按下、移动、抬起、取消序列；保留原有鼠标主按钮和触摸输入规则。 |
| `pointerenter` / `pointerleave` | 进入或离开交互节点。每个进入/离开的节点产生自己的事件，祖先监听可通过 `target` 区分。 |
| `pointeractivate` | 完整且未取消的 down/up 所产生的语义激活，包含基于逻辑命中身份的 `clickCount`。 |
| `dblclick` | 第二次语义激活，或未被语义激活接管的原生双击兼容路径；不会重复通知。 |
| `wheel` | 滚轮，提供 `deltaX` / `deltaY`。 |
| `contextmenu` | 主界面命中路径上的右键菜单请求。 |

这些是框架事件名，例如鼠标按下使用 `pointerdown`，不是 `mousedown`。按钮的 `onClick`、文本框的 `onChange` 仍是独立的组件业务回调，不自动转为树上的事件。`pointeractivate` 在旧的 `onPointerUp` 处理完成后产生；其中调用 `preventDefault()` 不能撤销已经执行的按钮 `onClick`。要阻止按钮本次操作，应在 `pointerdown` 或 `pointerup` 监听中取消默认处理。

### 捕获、冒泡和窗口边界

命中路径上的监听顺序为：

```text
窗口捕获 → 容器捕获 → 目标捕获 → 目标普通监听 → 容器冒泡 → 窗口冒泡
```

传播在最近的 `RenderWindow` 截止，包括嵌套窗口。拥有窗口、其他兄弟窗口和未命中的组件不会收到这次事件。已有指针方法、滚轮和右键的默认处理同样不会越过该窗口边界。全局回调和显式业务通信仍是独立机制。

监听器使用 `RoutedPointerEvent`：

- `target` / `currentTarget`：实际目标和当前接收节点，类型为 `HitTestTarget`，支持虚拟化组件的逻辑命中。
- `targetEntry` / `currentEntry`：保留命中项的 `key`、`data` 和坐标空间。
- `phase` / `path`：当前阶段和窗口范围内的命中路径快照。
- `position` / `localPosition`：Canvas 坐标与当前节点局部坐标；移动及捕获期间会重新换算。
- `pointerId` / `pointerType` / `button` / `buttons`、修饰键、`timeStamp`、`clickCount`：输入信息。
- `deltaX` / `deltaY`：滚轮增量，其他事件为零。

### 默认行为和传播控制

新注册的监听器先执行，然后保留原有控件方法的处理流程。监听器不通过返回值消费事件：

| 方法 | 行为 |
| --- | --- |
| `stopPropagation()` | 停止向后续节点传播，保留同节点剩余监听与原有默认行为。 |
| `stopImmediatePropagation()` | 同时停止当前节点剩余监听和后续传播，保留默认行为。 |
| `preventDefault()` | 取消本次控件默认处理，不停止其他监听；不会回退此前完成的操作。 |
| `preventActivation()` | 阻止当前序列生成语义激活，不替代按钮自身的操作取消。 |

```ts
const off = window.addPointerEventListener('pointerup', event => {
  if (event.target === button && !canSave()) {
    event.preventDefault()
  }
}, { capture: true })
```

取消 move/up 默认处理时，框架会向原有控件发送取消处理，以清理 pressed、拖拽等状态；`pointercancel` 和 `pointerleave` 的终止清理仍会执行，不能用 `preventDefault()` 跳过。鼠标按下前的路由选择和焦点准备仍由运行时负责。

### 指针捕获与生命周期

监听器可以调用 `setPointerCapture()`，把当前按下序列的后续 move/up/cancel 定向到 `currentTarget`。这是持续交互的捕获，与捕获阶段不同：

```ts
const offDown = button.addPointerEventListener('pointerdown', event => {
  event.setPointerCapture()
})
const offUp = button.addPointerEventListener('pointerup', event => {
  event.releasePointerCapture()
})
```

捕获后的目标是捕获节点，路径仍截止于其窗口；`hasPointerCapture()` 可查询当前节点状态。这些方法只对活动的指针序列有效，wheel、hover、右键菜单和语义激活通知不建立新的捕获会话。

注册和取消规则与键盘监听一致：支持多个回调、`{ once: true }`、重复注册去重、幂等取消函数、按同一 `capture` 值移除，以及 `dispose()` 自动清理。派发中新增的监听从下一次事件生效，移除立即生效。路径失效或重入取代当前指针会话时，不再继续调用旧路径上的监听。

## 键盘事件

所有 `RenderObject` 组件（包括文本框、布局容器和 `RenderWindow`）支持通过 `addKeyboardEventListener` 注册 `keydown` / `keyup`。不提供 `keypress`；文本内容变化使用控件的 `onChange`，输入法提交仍由文本输入系统处理。

```ts
import { RenderTextBox, RenderWindow, type KeyboardEventListener } from 'directsurface'

const window = new RenderWindow({ title: '编辑', width: 420, height: 260 })
const textBox = new RenderTextBox({ value: '' })
window.addChild(textBox)

// 捕获：窗口先观察内部控件的按键。
const offCapture = window.addKeyboardEventListener('keydown', event => {
  if (event.isComposing) return
  console.log('捕获', event.key, event.target)
}, { capture: true })

const offTarget = textBox.addKeyboardEventListener('keydown', event => {
  console.log('文本框', event.key)
})

// 默认注册冒泡监听。同一节点可以注册多个回调。
const onWindowKey: KeyboardEventListener = event => {
  if (event.isComposing || event.key !== 'F2') return
  event.preventDefault() // 阻止后续控件默认按键处理及浏览器默认行为
  console.log('窗口处理 F2')
}
window.addKeyboardEventListener('keydown', onWindowKey)

// 两种取消方式；移除时 capture 必须与注册时一致。
offCapture()
offTarget()
window.removeKeyboardEventListener('keydown', onWindowKey)
```

上例展示 API；实际页面应在监听不再需要时调用取消函数，而不是注册后立即取消。

### 传播顺序与窗口隔离

焦点控件作为 `target`，沿组件父链构建路径，并在最近的 `RenderWindow` 或当前焦点作用域根节点截止：

```text
窗口捕获 → 容器捕获 → 目标捕获 → 目标普通监听 → 容器冒泡 → 窗口冒泡
```

没有焦点控件时，默认作用域使用当前活动根；弹出或模态作用域使用自身的第一个焦点根。不会遍历无关兄弟组件或其他窗口。窗口拥有关系不会加入事件路径；即使把一个 `RenderWindow` 嵌入另一个窗口，其事件也在内部窗口截止。

`RoutedKeyboardEvent` 提供 `key`、`code`、修饰键、`repeat`、`isComposing`、`location`、`timeStamp`，以及：

| 成员 | 含义 |
| --- | --- |
| `target` | 本次路由的焦点控件或回退根节点。 |
| `currentTarget` | 当前执行监听器的组件。 |
| `phase` | `DispatchPhase.Capture`、`Target` 或 `Bubble`；目标上的两组监听都是 `Target`。 |
| `stopPropagation()` | 停止向后续节点传播，不停止当前节点其他监听，不取消默认行为。 |
| `stopImmediatePropagation()` | 同时停止当前节点剩余监听和后续传播，不取消默认行为。 |
| `preventDefault()` | 取消控件与浏览器默认行为，不停止监听器传播。 |
| `defaultPrevented` | 是否已经取消默认行为。 |

这里的传播控制只针对框架组件树。要阻止输入、提交或默认快捷操作，应调用 `preventDefault()`，不能仅依赖 `stopPropagation()`。监听器返回值不用于消费事件。

### 与既有按键处理的关系

新注册的捕获、目标和冒泡监听先执行，然后才运行已有 `onKeyDown`、焦点作用域处理、Tab 导航及窗口未处理按键回调。因此窗口冒泡监听可以观察原先由文本框 `onKeyDown` 消费的按键。调用 `preventDefault()` 后，已有按键处理不会执行。未取消默认行为时，文本编辑、Enter 提交、Escape 和输入法逻辑继续使用原有实现；IME 按键会暴露给新监听器，业务快捷键通常应跳过 `isComposing`。

这不会把已有 `onKeyDown` 方法自动变成祖先冒泡监听，也不会把文本 `onChange` 转为键盘事件。原有全局快捷键注册仍是独立机制；需要窗口隔离的业务快捷键应注册在对应窗口上。

### 监听器生命周期

- 注册返回幂等的取消函数，也可调用 `removeKeyboardEventListener(type, listener, { capture })`。
- 同一组件上的相同类型、回调和 capture 值不会重复注册；capture 与普通监听可分别注册和移除。
- `{ once: true }` 表示仅执行一次，在调用前移除，防止重入时重复执行。
- 派发过程中新增的监听器从下一次事件开始生效，移除的监听器立即失效。
- 组件 `dispose()` 时清理监听器；销毁或改变路径后，不继续向失效路径派发。捕获回调改变焦点或关闭窗口时，不将同一个按键转交给新焦点控件执行默认操作。

## 异常与失效路径的清理

监听器可能隐藏、重新挂载控件或关闭窗口，框架会区分路径失效与新会话已经取代旧会话：

- 指针路径在监听回调中失效时，停止旧路径的后续监听，取消原控件的交互状态并阻止语义激活。移动阶段取消的序列会结束；抬起阶段由现有终止流程完成释放。窗口重新显示后不会继续拖动。
- `pointerleave` 是终止清理。即使离开监听隐藏或重新挂载了目标，只要仍是当前 hover 会话，原有离开处理也会执行，避免重新显示时残留 hover；若回调已重入并建立新的 hover，会保留新会话状态。
- 键盘监听或默认处理抛错时，该次按键按已处理收尾，阻断浏览器继续向文本输入桥接层派发；异常仍向调用方抛出，浏览器入口会报告异常。已经取消的 Enter 不会穿透触发提交，后续新的按键正常处理。

这些规则用于维护交互状态和输入边界，不会回滚监听回调中已经完成的业务操作。

## 手势和捕获

拖拽、滚动条、列宽调整、选区拖选等交互需要在 pointer down 后持续接收后续事件。组件应在交互结束、取消或销毁时释放相关状态。

## ContextMenu

右键菜单通常根据当前命中对象生成局部命令。菜单项应来自当前上下文，而不是常驻在每个行或节点上。

## 设计原则

- 事件处理应尽量局部化。
- 不要在 pointer move 中做全量数据计算。
- 不要在事件处理里创建大量临时对象。
- 组件销毁时必须清理拖拽、弹窗、输入会话和订阅。
