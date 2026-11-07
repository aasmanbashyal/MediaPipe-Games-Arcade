let engine;
self.onmessage = async ({ data }) => {
    try {
        if (data.type === 'initialize') {
            const { createGestureEngine } = await import('./gesture-engine.js');
            engine = await createGestureEngine();
            self.postMessage({ id: data.id, result: { backend: engine.backend } });
        } else if (data.type === 'frame') {
            const result = await engine.recognizeForVideo(data.image, data.timestamp);
            self.postMessage({ id: data.id, result });
        }
    } catch (error) { self.postMessage({ id: data.id, error: error.message || String(error) }); }
    finally { data.image?.close(); }
};
