const db = require('./db.js');
const fs = require('fs');

async function test() {
  const row = await db.get('SELECT filename FROM file_blobs LIMIT 1');
  if (!row) {
    console.log('No blobs found');
    process.exit(0);
  }
  console.log('Testing blob:', row.filename);
  const blob = await db.getFileBlob(row.filename);
  if (!blob) {
    console.log('getFileBlob returned null');
  } else {
    console.log('getFileBlob SUCCESS! Type:', blob.mimeType, 'Size:', blob.fileData.length);
  }
  process.exit(0);
}

setTimeout(test, 1000); // wait for DB init
