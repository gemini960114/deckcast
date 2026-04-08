import type { SlideTimings } from './types';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function extractEmbeddedMediaShapeId(slideXml: string): string | null {
  const match = slideXml.match(
    /<p:cNvPr id="(\d+)"[^>]*>\s*<a:hlinkClick[^>]*action="ppaction:\/\/media"/,
  );
  return match?.[1] ?? null;
}

function buildEmbeddedAudioTimingXml(shapeId: string, slideCount: number): string {
  const slideSpan = Math.max(1, slideCount);

  return (
    `<p:timing>` +
      `<p:tnLst>` +
        `<p:par>` +
          `<p:cTn id="101" dur="indefinite" restart="never" nodeType="tmRoot">` +
            `<p:childTnLst>` +
              `<p:par>` +
                `<p:cTn id="102" fill="hold" nodeType="clickEffect">` +
                  `<p:stCondLst><p:cond delay="0"/></p:stCondLst>` +
                  `<p:childTnLst>` +
                    `<p:audio>` +
                      `<p:cMediaNode vol="100000" mute="0" showWhenStopped="0" numSld="${slideSpan}">` +
                        `<p:cTn id="103" fill="hold" nodeType="clickEffect">` +
                          `<p:stCondLst><p:cond delay="0"/></p:stCondLst>` +
                        `</p:cTn>` +
                        `<p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl>` +
                      `</p:cMediaNode>` +
                    `</p:audio>` +
                  `</p:childTnLst>` +
                `</p:cTn>` +
              `</p:par>` +
            `</p:childTnLst>` +
          `</p:cTn>` +
        `</p:par>` +
      `</p:tnLst>` +
    `</p:timing>`
  );
}

export async function generatePptx(
  pdfBlob: Blob,
  timings: SlideTimings,
  audioBlob?: Blob
): Promise<Blob> {
  // @ts-expect-error: Next.js/TypeScript cannot resolve https imports at build time
  const pdfjsLib = await import(/* webpackIgnore: true */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.worker.min.mjs';

  const PptxGenJS = (await import('pptxgenjs')).default;
  const JSZip = (await import('jszip')).default;

  const arrayBuffer = await pdfBlob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';

  const audioBase64 = audioBlob ? await blobToBase64(audioBlob) : null;
  const audioMime = audioBlob?.type || 'audio/wav';
  const audioExtn = audioMime.includes('mpeg') || audioMime.includes('mp3') ? 'mp3' : 'wav';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context not available');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const imgBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

    const slide = pptx.addSlide();
    slide.addImage({ data: `image/jpeg;base64,${imgBase64}`, x: 0, y: 0, w: '100%', h: '100%' });

    if (i === 1 && audioBase64) {
      slide.addMedia({
        type: 'audio',
        extn: audioExtn,
        data: `audio/${audioExtn};base64,${audioBase64}`,
        x: 0.1,
        y: 0.1,
        w: 0.8,
        h: 0.8,
      });
    }
  }

  const pptxBuffer = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer;
  const zip = await JSZip.loadAsync(pptxBuffer);

  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)![1]);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)![1]);
      return na - nb;
    });

  for (let i = 0; i < slideFiles.length; i++) {
    let xml = await zip.file(slideFiles[i])?.async('string');
    if (!xml) continue;
    const durationMs = Math.max(Math.round((timings[i]?.durationSec ?? 5) * 1000), 1000);
    const isLastSlide = i === slideFiles.length - 1;
    const finalDurationMs = isLastSlide ? durationMs + 2000 : durationMs;
    const effectXML = '<p:fade/>';
    const transitionBlock = `<p:transition spd="med" advClick="1" advTm="${finalDurationMs}">${effectXML}</p:transition>`;

    let timingBlock = '';
    if (i === 0 && audioBlob && !xml.includes('<p:timing')) {
      const shapeId = extractEmbeddedMediaShapeId(xml);
      if (shapeId) {
        timingBlock = buildEmbeddedAudioTimingXml(shapeId, slideFiles.length);
      }
    }

    xml = xml.replace('</p:sld>', `${transitionBlock}${timingBlock}</p:sld>`);
    zip.file(slideFiles[i], xml);
  }

  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
