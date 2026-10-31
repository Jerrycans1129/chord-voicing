const installButton = document.getElementById('install-app');
const installStatus = document.getElementById('install-status');
let installPrompt;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = window.matchMedia('(display-mode: standalone)').matches;
});
installButton.addEventListener('click', async event => {
  event.stopPropagation();
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  installButton.hidden = true;
  try {
    await prompt.prompt();
    await prompt.userChoice;
  } catch {
    installStatus.textContent = '请通过浏览器菜单安装 App。';
  }
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installButton.hidden = true;
  installStatus.textContent = '已安装，可从桌面或应用列表打开。';
});
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    installStatus.textContent = '离线资源准备失败，请联网刷新后重试。';
  });
}
