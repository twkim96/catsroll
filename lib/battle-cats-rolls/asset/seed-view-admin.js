(() => {
  'use strict';

  const root = document.querySelector('[data-seed-view-admin]');
  const dialog = document.querySelector('[data-tsv-dialog]');
  if (!root || !dialog) return;

  const form = dialog.querySelector('[data-tsv-password-form]');
  const password = form.elements.password;
  const status = root.querySelector('[data-tsv-status]');
  const buttons = Array.from(root.querySelectorAll('[data-tsv-action]'));
  let action = null;

  const setBusy = (busy) => {
    buttons.forEach((button) => { button.disabled = busy; });
  };

  const showStatus = (message, state = '') => {
    status.textContent = message;
    status.dataset.state = state;
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      action = button.dataset.tsvAction;
      password.value = '';
      dialog.showModal();
      password.focus();
    });
  });

  dialog.querySelector('[data-tsv-cancel]').addEventListener('click', () => {
    action = null;
    dialog.close();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!action || !password.value) return;

    const selectedAction = action;
    const body = new URLSearchParams({action: selectedAction, password: password.value});
    action = null;
    password.value = '';
    dialog.close();
    setBusy(true);
    showStatus(selectedAction === 'check' ? '업데이트를 확인하고 있습니다...' :
      '업데이트와 배포를 요청하고 있습니다...');

    try {
      const response = await fetch(root.dataset.endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
        credentials: 'same-origin',
        body
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || '요청에 실패했습니다.');

      showStatus(result.message, 'success');
      if (result.workflow_url) {
        status.append(' ');
        const link = document.createElement('a');
        link.href = result.workflow_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = '진행 상황';
        status.append(link);
      }
    } catch (error) {
      showStatus(error.message || '요청에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  });
})();
