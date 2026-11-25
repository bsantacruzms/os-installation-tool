// Read-only startup test: exercise the bundled main process and renderer, not a browser mock.
const { app, BrowserWindow, dialog } = require('electron');
const { setTimeout: delay } = require('node:timers/promises');
dialog.showErrorBox = (title, detail) => console.error(`${title}: ${detail}`);
require('./build/main.cjs');

(async () => {
  await app.whenReady();
  for (let i = 0; i < 80; i++) {
    await delay(500);
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || !win.webContents.getURL().endsWith('/#desktop') || win.webContents.isLoading()) continue;
    const text = await win.webContents.executeJavaScript('document.body.innerText');
    if (text.includes('Refresh drive list') && !text.includes('Pairing code')) {
      win.setContentSize(800, 600);
      for (const family of ['windows', 'linux']) {
        await win.webContents.executeJavaScript(`{
          const select = document.querySelector('fieldset select');
          select.value = ${JSON.stringify(family)};
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }`);
        await delay(100);
        const fits = await win.webContents.executeJavaScript(`(() => {
          const root = document.documentElement;
          const create = [...document.querySelectorAll('button')].find(b => b.textContent === 'Create the USB stick');
          return root.scrollHeight <= innerHeight && root.scrollWidth <= innerWidth &&
            !!create && create.getBoundingClientRect().bottom <= innerHeight;
        })()`);
        if (!fits) {
          const layout = await win.webContents.executeJavaScript(`({
            viewport: [innerWidth, innerHeight], page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
            sections: [...document.querySelector('main').children].map(e => [e.tagName, Math.round(e.getBoundingClientRect().height)])
          })`);
          throw new Error(`${family} setup does not fit: ${JSON.stringify(layout)}`);
        }
      }
      console.log('Both setup screens fit at 800 x 600 with Create USB visible; no pairing or disk write.');
      win.close();
      return;
    }
    if (text.includes('Retry')) throw new Error(text);
  }
  throw new Error('Timed out waiting for the connected desktop USB picker.');
})().catch(error => { console.error(error); app.exit(1); });
