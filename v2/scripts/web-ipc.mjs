/** Send the owned web bind acknowledgement without leaving IPC failures unhandled. */
export function sendWebListeningAcknowledgement(ipcProcess, onSendFailure) {
  if (!ipcProcess.connected) return false;
  try {
    ipcProcess.send({ type: 'gelt:web-listening' }, error => {
      if (error) onSendFailure();
    });
    return true;
  } catch {
    onSendFailure();
    return false;
  }
}
