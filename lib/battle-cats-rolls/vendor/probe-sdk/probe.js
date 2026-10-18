import {App} from '@modelcontextprotocol/ext-apps';

const status = document.getElementById('connection');
const record = window.CatsrollSdkRecordDiagnostic;
const app = new App({name: 'Catsroll SDK connection probe', version: '1.0.0'});
let closed = false;
let timedOut = false;
// Register handlers before connecting, as in the official SDK quickstart.
app.ontoolresult = () => record('tool-result');
app.onerror = () => record('protocol-error');
app.onteardown = async () => {
  closed = true;
  clearTimeout(timeout);
  status.textContent = '연결 종료';
  record('teardown');
  return {};
};
const timeout = setTimeout(() => {
  timedOut = true;
  status.textContent = '연결 대기 초과 · 호스트 응답 없음';
  record('connect-timeout');
}, 10000);
record('connect-start');
app.connect().then(() => {
  clearTimeout(timeout);
  if (closed) return;
  status.textContent = 'SDK 연결 완료 · 계산 실행 없음';
  record(timedOut ? 'connected-late' : 'connected');
}).catch(() => {
  clearTimeout(timeout);
  if (closed) return;
  status.textContent = 'SDK 연결 실패';
  record('connect-error');
});
addEventListener('pagehide', event => {
  if (event.persisted) return;
  closed = true;
  clearTimeout(timeout);
  app.close().catch(() => record('close-error'));
});
