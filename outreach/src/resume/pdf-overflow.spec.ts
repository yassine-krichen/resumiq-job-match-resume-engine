import { PDFDocument, PDFName } from 'pdf-lib';

import { measureOverflowPoints, spillDepthPoints } from './pdf-overflow';

describe('spillDepthPoints', () => {
  it('measures from the top margin down to the deepest text line plus one line', () => {
    const content = 'q 1 0 0 1 72 720 cm BT /F3 9.96 Tf 26.1 25.04 Td[(a)]TJ ET BT /F3 9.96 Tf -1.2 -230.4 Td[(b)]TJ -11.95 Td[(c)]TJ ET';

    expect(spillDepthPoints(content)).toBeCloseTo(230.4 + 11.96, 1);
  });

  it('is one line for a page whose only text sits at the top', () => {
    expect(spillDepthPoints('BT 10 0 Td[(a)]TJ ET')).toBeCloseTo(11.96, 2);
  });

  it('is null for a page without positioned text', () => {
    expect(spillDepthPoints('q 0 0 612 792 re f Q')).toBeNull();
  });
});

describe('measureOverflowPoints', () => {
  it('is 0 for a one-page document', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();

    expect(await measureOverflowPoints(doc)).toBe(0);
  });

  it('measures the text that spills onto the extra pages of a document', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const second = doc.addPage();
    const content = 'q 1 0 0 1 72 720 cm BT /F1 10 Tf 0 -12 Td[(one)]TJ 0 -112 Td[(two)]TJ ET Q';
    second.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));

    const points = await measureOverflowPoints(doc);

    expect(points).toBeCloseTo(112 + 11.96, 1);
  });
});
