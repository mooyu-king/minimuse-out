// 本地像素处理；由 scripts/build-studio-worker.mjs 生成。
function removeEdgeColor(data, width, height, color, tolerance) {
    const result = new Uint8ClampedArray(data);
    const seen = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0, tail = 0;
    function visit(pixel) {
        if (seen[pixel])
            return;
        seen[pixel] = 1;
        const i = pixel * 4;
        if (data[i + 3] !== 0 && Math.max(Math.abs(data[i] - color[0]), Math.abs(data[i + 1] - color[1]), Math.abs(data[i + 2] - color[2])) > tolerance)
            return;
        queue[tail++] = pixel;
    }
    for (let x = 0; x < width; x++) {
        visit(x);
        visit((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
        visit(y * width);
        visit(y * width + width - 1);
    }
    while (head < tail) {
        const p = queue[head++];
        result[p * 4 + 3] = 0;
        const x = p % width, y = Math.floor(p / width);
        if (x)
            visit(p - 1);
        if (x < width - 1)
            visit(p + 1);
        if (y)
            visit(p - width);
        if (y < height - 1)
            visit(p + width);
    }
    return result;
}

function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function hsl(r, g, b) { r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2; let h = 0; if (d) {
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
} return [h, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l]; }
function fromHsl(h, s, l) { const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + h * 12) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }; return [f(0), f(8), f(4)]; }
function colorize(data, mask, hue, saturation, lightness, brightness = 0, contrast = 0, protectedColors = [], mappings = []) {
    const out = new Uint8ClampedArray(data), protectedRGB = protectedColors.map(rgb), pairs = mappings.map(m => ({ from: rgb(m.from), to: rgb(m.to) }));
    for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3])
            continue;
        const mix = mask ? mask[i + 3] / 255 : 1;
        if (!mix || protectedRGB.some(c => c.every((v, k) => Math.abs(v - data[i + k]) < 35)))
            continue;
        let [h, s, l] = hsl(data[i], data[i + 1], data[i + 2]);
        const mapping = pairs.find(m => m.from.every((v, k) => Math.abs(v - data[i + k]) < 45));
        if (mapping) {
            const src = hsl(...mapping.from), dst = hsl(...mapping.to);
            h = dst[0];
            s = dst[1];
            l = Math.max(0, Math.min(1, l + dst[2] - src[2]));
        }
        h = (h + hue / 360 + 1) % 1;
        s = Math.max(0, Math.min(1, s + saturation / 100));
        l = Math.max(0, Math.min(1, l + lightness / 100));
        const vals = fromHsl(h, s, l);
        for (let k = 0; k < 3; k++) {
            const v = (vals[k] - 128) * (1 + contrast / 100) + 128 + brightness * 2.55;
            out[i + k] = data[i + k] * (1 - mix) + v * mix;
        }
    }
    return out;
}
function fringe(data, w, h, strength) { const out = new Uint8ClampedArray(data); for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 1 || data[i + 3] > 245)
            continue;
        const neighbors = [-w, w, -1, 1].map(o => i + o * 4).filter(n => data[n + 3] > 245);
        if (!neighbors.length)
            continue;
        for (let c = 0; c < 3; c++) {
            const value = neighbors.reduce((v, n) => v + data[n + c], 0) / neighbors.length;
            out[i + c] = data[i + c] + (value - data[i + c]) * strength / 100;
        }
    } return out; }

function processPixels(data, width, height, selection, r) {
    const result = new Uint8ClampedArray(data);
    if (r.remove) {
        const removed = removeEdgeColor(result, width, height, rgb(r.key), r.tolerance);
        for (let i = 3; i < result.length; i += 4)
            result[i] += (removed[i] - result[i]) * selection[i] / 255;
    }
    if (r.defringe) {
        const repaired = fringe(result, width, height, r.defringe);
        for (let i = 0; i < result.length; i += 4)
            for (let k = 0; k < 3; k++)
                result[i + k] += (repaired[i + k] - result[i + k]) * selection[i + 3] / 255;
    }
    return colorize(result, selection, r.hue, r.saturation, r.lightness, r.brightness, r.contrast, r.protected, r.mappings);
}

self.onmessage = ({data:m}) => { try { const result=processPixels(m.data,m.width,m.height,m.selection,m.recipe); self.postMessage({id:m.id,result},[result.buffer]); } catch(e) { self.postMessage({id:m.id,error:e.message||'Pixel processing failed'}); } };
