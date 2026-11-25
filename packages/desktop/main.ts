import { app, BrowserWindow, dialog, Menu, screen, session, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentServer } from '../agent/src/server.js';

app.setPath('userData', join(tmpdir(), 'osit-desktop'));
let window: BrowserWindow | null = null;

async function launch() {
  const token = randomBytes(32).toString('hex');
  const agent = createAgentServer({ host: '127.0.0.1', port: 0, pairingCode: token,
    workDirectory: join(tmpdir(), 'osit-scratch'), version: app.getVersion(), webRoot: null });
  await agent.listen();
  const origin = `http://127.0.0.1:${agent.port}`;
  const local = session.fromPartition('osit-window');
  local.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  local.webRequest.onBeforeRequest((request, reply) => reply({ cancel: new URL(request.url).origin !== origin }));
  // Authenticate only this window's requests to this instance. The renderer never receives the secret.
  local.webRequest.onBeforeSendHeaders({ urls: [`${origin}/agent/*`] }, (request, reply) => {
    if (request.webContentsId === window?.webContents.id && new URL(request.url).origin === origin)
      request.requestHeaders.Authorization = `Bearer ${token}`;
    reply({ requestHeaders: request.requestHeaders });
  });
  local.on('will-download', (event) => event.preventDefault());
  Menu.setApplicationMenu(null);
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  window = new BrowserWindow({ width: Math.min(820, workArea.width), height: Math.min(680, workArea.height),
    minWidth: Math.min(550, workArea.width), minHeight: Math.min(480, workArea.height),
    title: 'OS Installation Tool', webPreferences: { session: local, sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).protocol === 'https:') void shell.openExternal(url).catch(error => dialog.showErrorBox('Cannot open link', String(error)));
    return { action: 'deny' };
  });
  window.on('close', event => {
    if (agent.jobs.hasActiveJob()) {
      event.preventDefault();
      dialog.showMessageBoxSync({ type: 'info', message: 'Finish or cancel the current USB job before closing the window.' });
    }
  });
  window.on('closed', () => { window = null; void agent.close().finally(() => app.quit()); });
  await window.loadURL(`${origin}/#desktop`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  void app.whenReady().then(launch).catch(error => {
    dialog.showErrorBox('Cannot start OS Installation Tool', String(error));
    app.exit(1);
  });
}
