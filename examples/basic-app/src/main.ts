import {
  Application,
  ImGuiLightTheme,
  RenderButton,
  RenderPage,
  RenderStackPanel,
  RenderText,
  RenderTextBox,
  RenderWindow,
  loadDirectSurfaceFonts,
  type AppHost,
} from 'ds-ui'

function createApp(): AppHost {
  let clicks = 0
  const greeting = new RenderText('Hello, world!')
  const counter = new RenderText('Clicks: 0')
  const content = new RenderStackPanel({ padding: 32, spacing: 16 })

  content.addChild(new RenderText('DirectSurface', { role: 'title' }))
  content.addChild(new RenderText('A small app using the published ds-ui package.'))
  content.addChild(new RenderTextBox({
    width: 280,
    value: 'world',
    placeholder: 'Your name',
    onChange: value => { greeting.text = `Hello, ${value || 'world'}!` },
  }))
  content.addChild(greeting)
  content.addChild(new RenderButton({
    label: 'Add a click',
    onClick: () => { counter.text = `Clicks: ${++clicks}` },
  }))
  content.addChild(counter)

  const mainWindow = new RenderWindow({ title: 'DirectSurface basic app', chrome: 'none' })
  mainWindow.setChildren([new RenderPage({ child: content })])
  return Application.mount('#app').run(mainWindow, { theme: ImGuiLightTheme })
}

let host: AppHost | undefined
void loadDirectSurfaceFonts().then(() => { host = createApp() })
window.addEventListener('pagehide', () => host?.dispose(), { once: true })
import.meta.hot?.dispose(() => host?.dispose())
