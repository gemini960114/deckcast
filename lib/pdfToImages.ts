import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * Render each PDF page to a base64 JPEG string using the same CDN PDF.js
 * as generatePptx.ts (scale=2, quality=0.85). Client-side only.
 * Used by VideoExportButton to send slides to the server for FFmpeg assembly.
 */
export async function pdfToJpegBase64(pdfBlob: Blob, scale = 2): Promise<string[]> {
  // @ts-expect-error: Next.js/TypeScript cannot resolve https imports at build time
  const pdfjsLib = await import(/* webpackIgnore: true */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.worker.min.mjs';

  const arrayBuffer = await pdfBlob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images: string[] = [];

  for (let i = 1; i <= (pdf as { numPages: number }).numPages; i++) {
    const page = await (pdf as { getPage: (n: number) => Promise<unknown> }).getPage(i);
    const viewport = (page as { getViewport: (o: { scale: number }) => { width: number; height: number } }).getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context not available');
    await (page as { render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> } })
      .render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
  }

  return images;
}

let pdfjsLib: typeof import('pdfjs-dist') | null = null;

async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  }
  return pdfjsLib;
}

export async function pdfToImages(file: File, scale = 1.0): Promise<string[]> {
  const pdfjs = await getPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf: PDFDocumentProxy = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    pages.push(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
  }
  return pages;
}

export function getAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = reject;
    audio.src = url;
  });
}
