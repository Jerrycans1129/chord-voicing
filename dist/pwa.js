if ('serviceWorker' in navigator && window.isSecureContext) {
  const workers = navigator.serviceWorker;
  const initialController = workers.controller;
  const updateButton = document.getElementById('load-update');
  workers.addEventListener('controllerchange', () => {
    if (initialController && workers.controller !== initialController) {
      updateButton.hidden = false;
    }
  });
  updateButton.addEventListener('click', () => window.location.reload());

  workers.register('./sw.js', {updateViaCache: 'none'}).then(registration => {
    const check = () => registration.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    return check();
  }).catch(() => {});
}
