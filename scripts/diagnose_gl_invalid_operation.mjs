import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { THREE_MIN_JS } from '../mobile/components/games/hide-and-seek/threeMinJs.ts';
import { GLTF_LOADER_R128_JS } from '../mobile/components/games/hide-and-seek/gltfLoaderR128.ts';
import { LIBRARY_GLB_DATA_URI } from '../mobile/components/games/hide-and-seek/libraryGlbBase64.ts';
import { HORROR_CONFIG } from '../mobile/components/games/hide-and-seek/horrorConfig.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateHtml() {
  const root = path.resolve(__dirname, '..');
  const gameHtmlPath = path.resolve(root, 'mobile/components/games/hide-and-seek/gameHtml.ts');
  const file = fs.readFileSync(gameHtmlPath, 'utf8');

  const configJson = JSON.stringify(HORROR_CONFIG);

  const start = file.indexOf("return `");
  const end = file.lastIndexOf("`;") + 2;
  const fnBody = file.slice(start, end);
  const fn = new Function("THREE_MIN_JS", "GLTF_LOADER_R128_JS", "LIBRARY_GLB_DATA_URI", "configJson", fnBody);
  const html = fn(THREE_MIN_JS, GLTF_LOADER_R128_JS, LIBRARY_GLB_DATA_URI, configJson);

  return html;
}

async function runDiagnosis() {
  const html = generateHtml();

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--use-gl=angle', '--enable-webgl', '--no-sandbox']
  });

  const page = await browser.newPage({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2
  });

  page.on('console', msg => {
    if (msg.text().includes('INTERCEPT') || msg.text().includes('ATTRIB') || msg.type() === 'error') {
      console.log(`[Browser ${msg.type()}] ${msg.text()}`);
    }
  });

  await page.addInitScript(() => {
    const wrapGL = (gl) => {
      if (!gl || gl._intercepted) return;
      gl._intercepted = true;

      function inspectAttributes(label) {
        const maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        console.warn(`--- Inspecting attribs for ${label} ---`);
        for (let i = 0; i < maxAttribs; i++) {
          const enabled = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED);
          if (enabled) {
            const size = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_SIZE);
            const type = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_TYPE);
            const normalized = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED);
            const stride = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_STRIDE);
            const buffer = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
            const divisor = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_DIVISOR);
            let bufSize = 'null';
            if (buffer) {
              gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
              bufSize = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
            }
            console.warn(`[ATTRIB ${i}] enabled=true size=${size} type=${type} stride=${stride} divisor=${divisor} bufferSize=${bufSize}`);
          }
        }
      }

      let warned = 0;
      const origDrawElementsInstanced = gl.drawElementsInstanced;
      if (origDrawElementsInstanced) {
        gl.drawElementsInstanced = function(mode, count, type, offset, primcount) {
          origDrawElementsInstanced.call(this, mode, count, type, offset, primcount);
          const err = this.getError();
          if (err !== 0 && warned < 2) {
            warned++;
            console.warn(`[INTERCEPT] drawElementsInstanced ERROR ${err}: count=${count}, primcount=${primcount}`);
            inspectAttributes('drawElementsInstanced');
          }
        };
      }

      const origDrawArraysInstanced = gl.drawArraysInstanced;
      if (origDrawArraysInstanced) {
        gl.drawArraysInstanced = function(mode, first, count, primcount) {
          origDrawArraysInstanced.call(this, mode, first, count, primcount);
          const err = this.getError();
          if (err !== 0 && warned < 4) {
            warned++;
            console.warn(`[INTERCEPT] drawArraysInstanced ERROR ${err}: count=${count}, primcount=${primcount}`);
            inspectAttributes('drawArraysInstanced');
          }
        };
      }
    };

    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, attributes) {
      const ctx = origGetContext.call(this, type, attributes);
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
        wrapGL(ctx);
      }
      return ctx;
    };
  });

  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForTimeout(2000);

  await browser.close();
  server.close();
}

runDiagnosis().catch(err => {
  console.error(err);
  process.exit(1);
});
