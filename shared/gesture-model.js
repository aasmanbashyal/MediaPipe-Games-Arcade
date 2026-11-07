/** LiteRT inference runs off the render thread; only frame snapshots cross it. */
export async function createGestureModel({ signal } = {}) {
    if (signal?.aborted) throw new DOMException('Hand tracking initialization cancelled', 'AbortError');
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') {
        throw new Error('This browser cannot run camera inference workers. Use mouse or touch controls.');
    }
    // LiteRT's Emscripten loader uses importScripts, so the outer worker is
    // classic. Its application code is still loaded as a local ES module.
    const worker = new Worker(new URL('./gesture-worker.js', import.meta.url));
    let closed = false, busy = false, nextId = 1;
    const waiting = new Map();
    const request = (type, data = {}, transfer = []) => new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Hand tracking timed out. Retry or use pointer controls.')); stop(); }, 45000);
        waiting.set(id, { resolve, reject, timer });
        try { worker.postMessage({ type, id, ...data }, transfer); }
        catch (error) { waiting.delete(id); clearTimeout(timer); reject(error); }
    });
    function stop(reason = null) {
        if (closed) return;
        closed = true;
        worker.terminate();
        for (const pending of waiting.values()) {
            clearTimeout(pending.timer);
            if (reason) pending.reject(reason); else pending.resolve(null);
        }
        waiting.clear();
        signal?.removeEventListener('abort', abortInitialization);
    }
    const abortInitialization = () => stop(new DOMException('Hand tracking initialization cancelled', 'AbortError'));
    signal?.addEventListener('abort', abortInitialization, { once: true });
    worker.onmessage = ({ data }) => {
        const pending = waiting.get(data.id);
        if (!pending) return;
        waiting.delete(data.id); clearTimeout(pending.timer);
        if (data.error) pending.reject(new Error(data.error));
        else pending.resolve(data.result);
    };
    worker.onerror = event => {
        event.preventDefault();
        for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error(event.message || 'Hand tracking worker failed')); }
        waiting.clear(); stop();
    };
    try { await request('initialize'); }
    catch (error) { stop(); throw error; }
    finally { signal?.removeEventListener('abort', abortInitialization); }
    return {
        backend: 'litert-wasm', execution: 'worker',
        async recognizeForVideo(source, timestamp) {
            if (closed) throw new Error('Hand model is closed');
            if (busy) return null;
            busy = true;
            let image;
            try {
                image = await createImageBitmap(source);
                if (closed) { image.close(); return null; }
                return await request('frame', { image, timestamp }, [image]);
            } catch (error) { image?.close(); throw error;
            } finally { busy = false; }
        },
        close: stop,
    };
}
