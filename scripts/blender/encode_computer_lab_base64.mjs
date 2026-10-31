import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const glbPath = path.resolve(__dirname, 'output/computer_lab_production.glb');
const targetTsPath = path.resolve(rootDir, 'mobile/components/games/hide-and-seek/computerLabGlbBase64.ts');

if (!fs.existsSync(glbPath)) {
  console.error(`[-] GLB file not found: ${glbPath}`);
  process.exit(1);
}

const glbBuffer = fs.readFileSync(glbPath);
const base64Data = glbBuffer.toString('base64');
const dataUri = `data:model/gltf-binary;base64,${base64Data}`;

const tsContent = `// Auto-generated base64 data URI of scripts/blender/output/computer_lab_production.glb
export const COMPUTER_LAB_GLB_DATA_URI = "${dataUri}";
export const COMPUTER_LAB_PRODUCTION_GLB_BASE64 = COMPUTER_LAB_GLB_DATA_URI;
`;

fs.writeFileSync(targetTsPath, tsContent, 'utf-8');
console.log(`[+] Wrote ${targetTsPath} (${(tsContent.length / 1024).toFixed(1)} KB)`);

