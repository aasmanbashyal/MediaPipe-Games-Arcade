/**
 * Hand-model pre/post-processing follows the MediaPipe palm/landmark/gesture
 * graphs and calculators, Copyright The MediaPipe Authors (Apache-2.0).
 * See THIRD_PARTY_NOTICES.md for source attribution and license information.
 * https://github.com/google-ai-edge/mediapipe/tree/master/mediapipe/tasks/cc/vision
 * https://www.apache.org/licenses/LICENSE-2.0
 * Geometry stays in source-image pixels until landmarks are projected.
 */
export function createPalmAnchors() {
    const anchors = [];
    for (const [grid, repeats] of [[24, 2], [12, 6]]) {
        for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
            for (let i = 0; i < repeats; i++) anchors.push({ x: (x + 0.5) / grid, y: (y + 0.5) / grid });
        }
    }
    return anchors;
}
const ANCHORS = createPalmAnchors();

export function intersectionOverUnion(a, b) {
    const intersection = Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2))
        * Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2));
    return intersection / Math.max(1e-9, a.w * a.h + b.w * b.h - intersection);
}

export function weightedSuppression(candidates, maxHands = 2) {
    let remaining = [...candidates].sort((a, b) => b.score - a.score);
    const selected = [];
    while (remaining.length && selected.length < maxHands) {
        const best = remaining[0];
        const overlap = remaining.filter(item => intersectionOverUnion(best, item) > 0.3);
        remaining = remaining.filter(item => intersectionOverUnion(best, item) <= 0.3);
        const weight = overlap.reduce((sum, item) => sum + item.score, 0);
        const mean = read => overlap.reduce((sum, item) => sum + read(item) * item.score, 0) / weight;
        selected.push({ score: best.score, x: mean(item => item.x), y: mean(item => item.y),
            w: mean(item => item.w), h: mean(item => item.h),
            points: best.points.map((_, index) => ({ x: mean(item => item.points[index].x), y: mean(item => item.points[index].y) })) });
    }
    return selected;
}

export function decodePalms(boxes, logits, width, height, threshold = 0.5) {
    if (boxes.length !== 2016 * 18 || logits.length !== 2016) throw new Error('Unexpected palm output shape');
    const scale = 192 / Math.max(width, height);
    const padX = (192 - width * scale) / 2, padY = (192 - height * scale) / 2;
    const candidates = [];
    ANCHORS.forEach((anchor, index) => {
        const score = 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, logits[index]))));
        if (score < threshold) return;
        const offset = index * 18;
        const project = position => ({ x: (boxes[position] + anchor.x * 192 - padX) / scale,
            y: (boxes[position + 1] + anchor.y * 192 - padY) / scale });
        const center = project(offset);
        const w = boxes[offset + 2] / scale, h = boxes[offset + 3] / scale;
        if (!(w > 0 && h > 0) || !Number.isFinite(center.x + center.y + w + h)) return;
        candidates.push({ ...center, w, h, score, points: Array.from({ length: 7 }, (_, i) => project(offset + 4 + i * 2)) });
    });
    return weightedSuppression(candidates);
}

export function palmToRoi(palm) {
    const wrist = palm.points[0], middle = palm.points[2];
    let rotation = Math.PI / 2 - Math.atan2(-(middle.y - wrist.y), middle.x - wrist.x);
    rotation -= 2 * Math.PI * Math.floor((rotation + Math.PI) / (2 * Math.PI));
    return { x: palm.x + 0.5 * palm.h * Math.sin(rotation),
        y: palm.y - 0.5 * palm.h * Math.cos(rotation),
        size: 2.6 * Math.max(palm.w, palm.h), rotation };
}

export function projectLandmarks(raw, roi, width, height) {
    const cos = Math.cos(roi.rotation), sin = Math.sin(roi.rotation);
    return Array.from({ length: 21 }, (_, i) => {
        const x = (raw[3 * i] / 224 - 0.5) * roi.size;
        const y = (raw[3 * i + 1] / 224 - 0.5) * roi.size;
        return { x: (roi.x + x * cos - y * sin) / width,
            y: (roi.y + x * sin + y * cos) / height,
            z: raw[3 * i + 2] / (224 * 0.4) * roi.size / width };
    });
}

export function projectWorldLandmarks(raw, rotation) {
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    return Array.from({ length: 21 }, (_, i) => ({ x: raw[3 * i] * cos - raw[3 * i + 1] * sin,
        y: raw[3 * i] * sin + raw[3 * i + 1] * cos, z: raw[3 * i + 2] }));
}

/** Wrist-relative coordinates, scaled by XY extent, as expected by the embedder. */
export function normalizeGestureLandmarks(landmarks, imageSize = null) {
    const maxDimension = imageSize ? Math.max(imageSize.width, imageSize.height) : 1;
    const points = landmarks.map(point => ({
        x: point.x * (imageSize ? imageSize.width / maxDimension : 1),
        y: point.y * (imageSize ? imageSize.height / maxDimension : 1), z: point.z,
    }));
    const origin = points[0];
    const translated = points.map(point => ({ x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z }));
    const xs = translated.map(point => point.x), ys = translated.map(point => point.y);
    const scale = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 1e-5;
    return new Float32Array(translated.flatMap(point => [point.x / scale, point.y / scale, point.z / scale]));
}

/** Each detection owns a distinct slot even when two players use the same hand. */
export function assignHandSlots(results, previous) {
    const count = Math.min(2, results.landmarks.length);
    const preferred = index => results.handednesses[index]?.[0]?.categoryName === 'Right' ? 0 : 1;
    const distance = (detection, slot) => {
        const point = results.landmarks[detection][8], old = previous[slot];
        return (point.x - old.x) ** 2 + (point.y - old.y) ** 2;
    };
    if (count < 2) {
        if (!count) return [];
        const nearby = [0, 1].filter(slot => previous[slot].active && distance(0, slot) < 0.04);
        return [nearby.length ? nearby.sort((a, b) => distance(0, a) - distance(0, b))[0] : preferred(0)];
    }
    if (preferred(0) !== preferred(1)) return [preferred(0), preferred(1)];
    if (previous.some(pointer => pointer.active)) {
        return distance(0, 0) + distance(1, 1) <= distance(0, 1) + distance(1, 0) ? [0, 1] : [1, 0];
    }
    return results.landmarks[0][8].x >= results.landmarks[1][8].x ? [0, 1] : [1, 0];
}
