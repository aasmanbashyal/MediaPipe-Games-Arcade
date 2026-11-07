/** Convert a screen pointer to the raw coordinates used by the mirrored canvas. */
export function pointerToGame(clientX, clientY, rect) {
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return { x: 1 - Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

export function cameraErrorMessage(error) {
    switch (error?.name) {
        case 'NotAllowedError': return 'Camera access was denied. Allow access in your browser, then retry, or play with mouse or touch.';
        case 'NotFoundError': return 'No camera was found. Connect a camera or play with mouse or touch.';
        case 'NotReadableError': return 'The camera is busy. Close other camera apps and retry, or use mouse or touch.';
        case 'SecurityError': return 'Camera access needs HTTPS or localhost. You can still play with mouse or touch.';
        default: return 'Hand tracking could not start. Check your connection and retry, or play with mouse or touch.';
    }
}

export const MANUAL_GESTURES = [
    ['Open_Palm', 'Open palm', '✋'], ['Closed_Fist', 'Fist', '✊'],
    ['Victory', 'Victory', '✌️'], ['Thumb_Up', 'Thumb up', '👍'],
    ['Thumb_Down', 'Thumb down', '👎'], ['Pointing_Up', 'Point up', '☝️'],
    ['ILoveYou', 'Love', '🤟'],
];

/** Expiry is elapsed time, not a count of camera inference completions. */
export function expireCameraPointers(pointers, now, maxAge = 350) {
    for (const pointer of pointers) {
        if (now - (pointer.lastSeenAt ?? 0) > maxAge) {
            pointer.active = false;
            pointer.gesture = 'None';
            pointer.landmarks = null;
            pointer.grace = 0;
        }
    }
}
