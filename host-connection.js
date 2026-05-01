const NATIVE_HOST_NAME = 'com.fgregori.audio_tab_finder';

const _hostState = {
  port: null,
  connected: false,
  reconnectMs: 1000,
  pending: new Map(), // request_id -> { resolve, reject, timeoutId }
  onMessage: null,    // callback(msg) for unsolicited pushes (action_request)
  onConnectionChange: null, // callback(connected: boolean)
};

const HOST_REQUEST_TIMEOUT_MS = 3000;
const HOST_MAX_BACKOFF_MS = 60_000;
const HOST_BACKOFF_RESET_MS = 30_000;

function isHostConnected() {
  return _hostState.connected;
}

function setHostMessageHandler(fn) {
  _hostState.onMessage = fn;
}

function setHostConnectionChangeHandler(fn) {
  _hostState.onConnectionChange = fn;
}

async function connectToHost() {
  if (_hostState.port) return _hostState.port;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    _hostState.port = port;
    _hostState.connected = true;
    if (_hostState.onConnectionChange) _hostState.onConnectionChange(true);

    port.onMessage.addListener(handleIncomingMessage);
    port.onDisconnect.addListener(handleDisconnect);

    setTimeout(() => {
      if (_hostState.connected) _hostState.reconnectMs = 1000;
    }, HOST_BACKOFF_RESET_MS);

    return port;
  } catch (e) {
    handleDisconnect();
    throw e;
  }
}

function handleIncomingMessage(msg) {
  if (msg && msg.request_id && _hostState.pending.has(msg.request_id)) {
    const { resolve, timeoutId } = _hostState.pending.get(msg.request_id);
    clearTimeout(timeoutId);
    _hostState.pending.delete(msg.request_id);
    resolve(msg);
    return;
  }
  if (_hostState.onMessage) {
    _hostState.onMessage(msg);
  }
}

function handleDisconnect() {
  _hostState.port = null;
  _hostState.connected = false;
  if (_hostState.onConnectionChange) _hostState.onConnectionChange(false);

  for (const { reject, timeoutId } of _hostState.pending.values()) {
    clearTimeout(timeoutId);
    reject(new Error('host disconnected'));
  }
  _hostState.pending.clear();

  const delay = _hostState.reconnectMs;
  _hostState.reconnectMs = Math.min(delay * 2, HOST_MAX_BACKOFF_MS);
  setTimeout(() => {
    connectToHost().catch(() => { /* will retry via the next disconnect */ });
  }, delay);
}

function sendToHost(message) {
  return new Promise((resolve, reject) => {
    if (!_hostState.connected || !_hostState.port) {
      reject(new Error('host not connected'));
      return;
    }
    const requestId = crypto.randomUUID();
    const messageWithId = { ...message, request_id: requestId };

    const timeoutId = setTimeout(() => {
      _hostState.pending.delete(requestId);
      reject(new Error('host request timeout'));
    }, HOST_REQUEST_TIMEOUT_MS);

    _hostState.pending.set(requestId, { resolve, reject, timeoutId });

    try {
      _hostState.port.postMessage(messageWithId);
    } catch (e) {
      clearTimeout(timeoutId);
      _hostState.pending.delete(requestId);
      reject(e);
    }
  });
}

function sendToHostFireAndForget(message) {
  if (!_hostState.connected || !_hostState.port) return;
  try {
    _hostState.port.postMessage(message);
  } catch (e) {
    // swallow; will reconnect on next attempt
  }
}
