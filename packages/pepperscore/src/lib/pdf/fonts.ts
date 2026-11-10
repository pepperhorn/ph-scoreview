import type { jsPDF } from 'jspdf';
import regular from './assets/Poppins-Regular.ttf?url';
import bravura from './assets/PepperScoreMusic.ttf?url';
import petaluma from './assets/PepperScoreHand.ttf?url';
import script from './assets/PepperScoreHandText.ttf?url';
import semibold from './assets/Poppins-SemiBold.ttf?url';

/** TrueType copies of the same OFL Poppins faces as the reader. Loaded only during export. */
export async function embedFonts(pdf: jsPDF, signal: AbortSignal): Promise<FontFace[]> {
  const faces: FontFace[] = [];
  try {
    for (const [url, family, style] of [[regular, 'Poppins', 'normal'], [semibold, 'Poppins', 'bold'], [bravura, 'Bravura', 'normal'], [petaluma, 'Petaluma', 'normal'], [script, 'Petaluma Script', 'normal']] as const) {
      signal.throwIfAborted();
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error('Could not load the PDF text font. Please retry.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const face = await new FontFace(family, bytes.buffer, { weight: style === 'bold' ? '700' : '400' }).load();
      document.fonts.add(face); faces.push(face);
      const filename = `${family === 'Bravura' ? 'PepperScoreMusic' : family === 'Petaluma' ? 'PepperScoreHand' : family === 'Petaluma Script' ? 'PepperScoreHandText' : 'Poppins'}-${style}.ttf`;
      pdf.addFileToVFS(filename, btoa(binary));
      pdf.addFont(filename, family, style);
      if (family !== 'Poppins') pdf.addFont(filename, family, 'bold');
    }
    pdf.setFont('Poppins', 'normal');
    return faces;
  } catch (error) { for (const face of faces) document.fonts.delete(face); throw error; }
}
