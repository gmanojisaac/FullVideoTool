import type { CameraTransform } from './focus';

// Deterministic pixel-centre inverse mapping. No CSS/device-pixel coordinates
// enter this specification. Also usable in browser/offline verification.
export function renderFocusPixels(source: Uint8Array, t: CameraTransform, outputWidth = t.viewport.width, outputHeight = t.viewport.height): Uint8Array {
  if (source.length !== t.sourceWidth * t.sourceHeight * 4) throw new Error('Source RGBA dimensions do not match the camera transform.');
  const out = new Uint8Array(outputWidth * outputHeight * 4);
  const color = [1, 3, 5].map(i => parseInt(t.paddingColor.slice(i, i + 2), 16));
  const ratioX = t.viewport.width / outputWidth, ratioY = t.viewport.height / outputHeight;
  for (let y = 0; y < outputHeight; y++) {
    const sy = ((y + 0.5) * ratioY - t.translation.y) / t.scale - 0.5;
    for (let x = 0; x < outputWidth; x++) {
      const index = (y * outputWidth + x) * 4;
      const sx = ((x + 0.5) * ratioX - t.translation.x) / t.scale - 0.5;
      if (sx < -0.5 || sy < -0.5 || sx >= t.sourceWidth - 0.5 || sy >= t.sourceHeight - 0.5) { out[index] = color[0]; out[index + 1] = color[1]; out[index + 2] = color[2]; out[index + 3] = 255; continue; }
      const px = Math.max(0, Math.min(t.sourceWidth - 1, sx)), py = Math.max(0, Math.min(t.sourceHeight - 1, sy));
      const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(x0 + 1, t.sourceWidth - 1), y1 = Math.min(y0 + 1, t.sourceHeight - 1);
      const fx = px - x0, fy = py - y0;
      const p0 = (y0 * t.sourceWidth + x0) * 4, p1 = (y0 * t.sourceWidth + x1) * 4;
      const p2 = (y1 * t.sourceWidth + x0) * 4, p3 = (y1 * t.sourceWidth + x1) * 4;
      const a0 = source[p0 + 3] / 255 * (1 - fx) * (1 - fy), a1 = source[p1 + 3] / 255 * fx * (1 - fy);
      const a2 = source[p2 + 3] / 255 * (1 - fx) * fy, a3 = source[p3 + 3] / 255 * fx * fy;
      const alpha = a0 + a1 + a2 + a3;
      for (let c = 0; c < 3; c++) out[index + c] = Math.round(source[p0 + c] * a0 + source[p1 + c] * a1 + source[p2 + c] * a2 + source[p3 + c] * a3 + color[c] * (1 - alpha));
      out[index + 3] = 255;
    }
  }
  return out;
}
