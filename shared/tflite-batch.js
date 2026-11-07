/**
 * LiteRT.js 2.6 requires concrete input types. The official gesture classifier
 * stores shape [1,128] with shape_signature [-1,128]. Specialize its dynamic
 * batch signatures to the existing batch-one shapes without changing weights.
 * Field numbers follow tensorflow/lite/schema/schema.fbs (Model/SubGraph/Tensor).
 */
export function specializeBatchOne(modelBytes) {
    const bytes = modelBytes.slice();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 8 || String.fromCharCode(...bytes.slice(4, 8)) !== 'TFL3') throw new Error('Invalid TFLite model');
    const field = (table, index) => {
        const vtable = table - view.getInt32(table, true);
        const offset = 4 + index * 2;
        if (offset >= view.getUint16(vtable, true)) return 0;
        const value = view.getUint16(vtable + offset, true);
        return value ? table + value : 0;
    };
    const vector = position => {
        if (!position) return { length: 0, start: 0 };
        const head = position + view.getUint32(position, true);
        const length = view.getUint32(head, true);
        if (head + 4 + length * 4 > bytes.length) throw new Error('Invalid model vector');
        return { length, start: head + 4 };
    };
    const tableAt = (list, index) => {
        const position = list.start + index * 4;
        return position + view.getUint32(position, true);
    };
    const subgraphs = vector(field(view.getUint32(0, true), 2));
    for (let graphIndex = 0; graphIndex < subgraphs.length; graphIndex++) {
        const tensors = vector(field(tableAt(subgraphs, graphIndex), 0));
        for (let tensorIndex = 0; tensorIndex < tensors.length; tensorIndex++) {
            const tensor = tableAt(tensors, tensorIndex);
            const shape = vector(field(tensor, 0));
            const signature = vector(field(tensor, 7));
            if (!signature.length) continue;
            if (shape.length !== signature.length) throw new Error('Inconsistent model shape signature');
            for (let axis = 0; axis < signature.length; axis++) {
                const position = signature.start + axis * 4;
                if (view.getInt32(position, true) >= 0) continue;
                const size = view.getInt32(shape.start + axis * 4, true);
                if (axis !== 0 || size !== 1) throw new Error('Only dynamic batch-one gesture models are supported');
                view.setInt32(position, 1, true);
            }
        }
    }
    return bytes;
}
