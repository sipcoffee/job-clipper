import { capturePage } from '../lib/capture'
export default defineBackground(() => {
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined || tab.windowId === undefined) return
    const tabId = tab.id
    const key = 'capture:' + tab.windowId
    const token = crypto.randomUUID()
    const initial = { token, tabId, url: tab.url || '', pending: true }
    const opened = chrome.sidePanel.open({ windowId: tab.windowId })
    void (async () => {
      await chrome.storage.session.set({ [key]: initial })
      let result
      try {
        result = (
          await chrome.scripting.executeScript({
            target: { tabId },
            func: capturePage,
          })
        )[0]?.result
      } catch {
        /* Restricted pages support manual capture. */
      }
      const pending = (await chrome.storage.session.get(key))[key] as
        | typeof initial
        | undefined
      if (pending?.token === token)
        await chrome.storage.session.set({
          [key]: { ...initial, pending: false, result: result || null },
        })
      await opened
    })()
  })
})
