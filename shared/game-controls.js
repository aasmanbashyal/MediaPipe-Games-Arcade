/** Accessible controls shared by every game; game clocks own pause semantics. */
export function createGameControls({ getState, onPause, onResume, onRestart }) {
    const toolbar = document.createElement('nav');
    toolbar.className = 'game-toolbar';
    toolbar.setAttribute('aria-label', 'Game controls');
    toolbar.innerHTML = '<a href="../../index.html">← Arcade</a><button type="button" id="pauseGameBtn">Pause <kbd>Esc</kbd></button>';
    const dialog = document.createElement('dialog');
    dialog.className = 'pause-dialog';
    dialog.setAttribute('aria-labelledby', 'pauseTitle');
    dialog.innerHTML = '<p class="eyebrow">TAKE A BREATHER</p><h2 id="pauseTitle">Game paused</h2><p>Your timer and score are on hold.</p><div class="pause-actions"><button type="button" id="resumeGameBtn">Resume game</button><button type="button" id="restartGameBtn">Restart round</button><button type="button" id="cameraOffBtn">Turn camera off · use pointer</button><a href="../../index.html">Back to arcade</a></div>';
    document.body.append(toolbar, dialog);
    let paused = false;
    const isActive = () => !['menu', 'results', 'loading'].includes(getState());

    function update() {
        toolbar.hidden = !isActive();
        dialog.querySelector('#cameraOffBtn').hidden = document.body.dataset.inputMode !== 'camera';
        const needsControls = document.body.dataset.inputMode === 'none';
        dialog.querySelector('#resumeGameBtn').disabled = needsControls;
        dialog.querySelector('#restartGameBtn').disabled = needsControls;
        if (!isActive() && paused) resume();
        document.body.dataset.paused = String(paused);
    }
    function pause() {
        if (paused || !isActive()) return;
        paused = true;
        onPause();
        document.body.dataset.paused = 'true';
        dialog.showModal();
        dialog.querySelector('#resumeGameBtn').focus();
    }
    function resume() {
        if (document.body.dataset.inputMode === 'none') return false;
        if (!paused) return true;
        paused = false;
        dialog.close();
        onResume();
        document.body.dataset.paused = 'false';
        toolbar.querySelector('button').focus({ preventScroll: true });
        return true;
    }
    function restart() {
        if (!resume()) return;
        onRestart();
        update();
    }
    toolbar.querySelector('button').addEventListener('click', pause);
    dialog.querySelector('#resumeGameBtn').addEventListener('click', resume);
    dialog.querySelector('#restartGameBtn').addEventListener('click', restart);
    dialog.querySelector('#cameraOffBtn').addEventListener('click', () => {
        document.dispatchEvent(new Event('arcade:use-pointer'));
        update();
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); resume(); });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !dialog.open) { event.preventDefault(); pause(); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    document.addEventListener('arcade:inputlost', pause);
    update();
    return { pause, resume, restart, update };
}
