interface VsCodeApi {
  postMessage(msg: unknown): void
}

function createApi(): VsCodeApi {
  // VS Code webview mode
  if (typeof window !== 'undefined' && 'acquireVsCodeApi' in window) {
    return (window as unknown as { acquireVsCodeApi: () => VsCodeApi }).acquireVsCodeApi()
  }

  // Standalone WebSocket mode
  const pending: unknown[] = []
  let socket: WebSocket | null = null
  let connected = false
  let reconnected = false

  function connect(): WebSocket {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/ws`)

    ws.onopen = () => {
      connected = true
      // Flush queued messages
      for (const msg of pending) ws.send(JSON.stringify(msg))
      pending.length = 0
      // On reconnect, re-request full state
      if (reconnected) {
        ws.send(JSON.stringify({ type: 'webviewReady' }))
      }
      reconnected = true
    }

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string)
        window.dispatchEvent(new MessageEvent('message', { data }))
      } catch { /* malformed message */ }
    }

    ws.onclose = () => {
      connected = false
      socket = null
      // Auto-reconnect after 2s
      setTimeout(() => { socket = connect() }, 2000)
    }

    ws.onerror = () => {
      // onclose will fire after this
    }

    return ws
  }

  socket = connect()

  return {
    postMessage(msg: unknown) {
      if (connected && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg))
      } else {
        pending.push(msg)
      }
    },
  }
}

export const vscode = createApi()
