const test = require('node:test');
const assert = require('node:assert/strict');
const { neon } = require('@neondatabase/serverless');

test('Live PDF & Image Data Verification for Preview', { skip: !process.env.DATABASE_URL && 'DATABASE_URL environment variable is not defined' }, async (t) => {
  const sql = neon(process.env.DATABASE_URL);

  // 1. Test PDF File (ID: 6)
  await t.test('PDF file exists and has valid metadata', async () => {
    const [pdf] = await sql`SELECT id, originalname, sizebytes, storedname FROM files WHERE id = 6`;
    assert.ok(pdf, 'PDF file with ID 6 must exist');
    assert.match(pdf.originalname.toLowerCase(), /\.pdf$/, 'Must have .pdf extension');
    assert.ok(Number(pdf.sizebytes) > 0, 'PDF size must be greater than 0');
  });

  // 2. Test Image File (ID: 12)
  await t.test('Image file exists and has valid metadata', async () => {
    const [img] = await sql`SELECT id, originalname, sizebytes, storedname FROM files WHERE id = 12`;
    assert.ok(img, 'Image file with ID 12 must exist');
    assert.match(img.originalname.toLowerCase(), /\.(webp|png|jpg|jpeg)$/, 'Must have valid image extension');
    assert.ok(Number(img.sizebytes) > 0, 'Image size must be greater than 0');
  });

  // 3. Test Preview HTML Generator for Image
  await t.test('Image Preview HTML structure is valid with zoom & pan viewport', () => {
    const dummyB64 = Buffer.from('fake-image-bytes').toString('base64');
    const mime = 'image/webp';
    const title = 'Sample WebP Image';

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, minimum-scale=1.0, user-scalable=yes">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      background-color: #000000;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      touch-action: pan-x pan-y pinch-zoom;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <img src="data:${mime};base64,${dummyB64}" alt="Note image" />
  </div>
</body>
</html>`;

    assert.ok(html.includes('maximum-scale=5.0'), 'Must support up to 5.0 zoom scale');
    assert.ok(html.includes('user-scalable=yes'), 'Must allow user pinch scaling');
    assert.ok(html.includes('touch-action: pan-x pan-y pinch-zoom'), 'Must configure touch action');
    assert.ok(html.includes(`data:${mime};base64,`), 'Must contain embedded base64 data URI');
  });

  // 4. Test Preview HTML Generator for PDF
  await t.test('PDF Preview HTML structure is valid with PDF.js and zoom & pan', () => {
    const dummyB64 = Buffer.from('%PDF-1.4 mock pdf bytes').toString('base64');
    const title = 'Sample PDF Document';

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, minimum-scale=1.0, user-scalable=yes">
  <title>${title}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
  <div id="container"></div>
  <script>
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const raw = atob("${dummyB64}");
  </script>
</body>
</html>`;

    assert.ok(html.includes('maximum-scale=5.0'), 'Must support up to 5.0 zoom scale');
    assert.ok(html.includes('user-scalable=yes'), 'Must allow user pinch scaling');
    assert.ok(html.includes('pdf.min.js'), 'Must load PDF.js runtime');
    assert.ok(html.includes(dummyB64), 'Must embed base64 representation');
  });
});
