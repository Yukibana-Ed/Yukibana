/** Turning the image a person chose into the bytes of a profile picture, in their browser, with what the browser
 *  already has: `createImageBitmap` decodes whatever image format it can show, and a canvas encodes WebP.
 *
 *  Loaded only with the cropper (`PictureCropper.svelte`), which a page imports when someone chooses a file, so none
 *  of this is in a page's bundle. Safari decodes WebP but cannot encode it (`toBlob` silently answers with a PNG,
 *  WebKit bug 226950); there, and only there, libwebp compiled to WebAssembly (`@jsquash/webp`, about 300 KiB) is
 *  loaded on top, the first time a picture is saved.
 */

import type { View } from './crop';
import { PICTURE_SIZE } from './webp';

/** The WebP quality, from 0 to 1. A face at 256 pixels shows no artefacts at this; 0.9 doubles the size for nothing a
 *  person sees at 40. */
export const QUALITY = 0.82;

/** Returns `file` decoded, upright as its EXIF orientation says, or throws an Error whose message is a sentence for
 *  the person: the browser could not read it (a HEIC photo outside Safari, a PDF, a corrupt file). */
export async function decode(file: Blob): Promise<ImageBitmap> {
    try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        throw new Error('This browser cannot read that file as an image. Choose a JPEG, PNG, WebP, GIF or AVIF picture.');
    }
}

/** Returns the square `view` of `image` as a `PICTURE_SIZE`-pixel WebP picture, which `pictureProblem` accepts.
 *
 *  - Requires: `view` is a view of `image` (`crop.ts`). */
export async function encode(image: ImageBitmap, view: View): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = PICTURE_SIZE;
    canvas.height = PICTURE_SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('This browser gave the page no canvas to draw the picture on.');
    await draw(ctx, image, view);
    const native = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', QUALITY));
    if (native !== null && native.type === 'image/webp') return native;
    const { default: webp } = await import('@jsquash/webp/encode');
    const bytes = await webp(ctx.getImageData(0, 0, PICTURE_SIZE, PICTURE_SIZE), { quality: QUALITY * 100 });
    return new Blob([bytes], { type: 'image/webp' });
}

/** Draws the square `view` of `image` over the whole of `ctx`'s canvas. A phone photo is ten or more times larger than
 *  the picture, and one `drawImage` that far down skips pixels and aliases in some browsers, so the browser is asked
 *  to resize it with its best filter first; where it cannot, the canvas's smoothing does. */
async function draw(ctx: CanvasRenderingContext2D, image: ImageBitmap, view: View): Promise<void> {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    try {
        const resized = await createImageBitmap(image, view.x, view.y, view.side, view.side, {
            resizeWidth: PICTURE_SIZE,
            resizeHeight: PICTURE_SIZE,
            resizeQuality: 'high',
        });
        ctx.drawImage(resized, 0, 0);
        resized.close();
    } catch {
        ctx.drawImage(image, view.x, view.y, view.side, view.side, 0, 0, PICTURE_SIZE, PICTURE_SIZE);
    }
}
