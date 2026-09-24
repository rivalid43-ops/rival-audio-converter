const assert = require('assert');

const MAX_AUDIO_SIZE = 100 * 1024 * 1024;
const supportedTypes = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/webm']);
const supportedExtensions = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.webm']);

function validateFile(file) {
  if (!file) return 'Audio file is required';
  if (!file.size) return 'Audio file is empty';
  if (file.size > MAX_AUDIO_SIZE) return 'File is too large';
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!supportedTypes.has(file.type) && !supportedExtensions.has(extension)) return 'Unsupported audio format';
  return '';
}

function validAssetId(value) { return /^\d+$/.test(String(value || '').trim()) && Number(value) > 0; }
function validSpeed(value) { return Number.isFinite(Number(value)) && Number(value) >= 0.5 && Number(value) <= 4; }
function validRobloxSpeed(value) { return Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 16; }

assert.strictEqual(validateFile(null), 'Audio file is required');
assert.strictEqual(validateFile({ name: 'empty.mp3', type: 'audio/mpeg', size: 0 }), 'Audio file is empty');
assert.strictEqual(validateFile({ name: 'large.mp3', type: 'audio/mpeg', size: MAX_AUDIO_SIZE + 1 }), 'File is too large');
assert.strictEqual(validateFile({ name: 'malware.exe', type: 'application/octet-stream', size: 10 }), 'Unsupported audio format');
assert.strictEqual(validateFile({ name: 'sound.mp3', type: 'audio/mpeg', size: 10 }), '');
assert.strictEqual(validAssetId('123456'), true);
assert.strictEqual(validAssetId('0'), false);
assert.strictEqual(validAssetId('fake-id'), false);
assert.strictEqual(validSpeed(2), true);
assert.strictEqual(validSpeed(0.1), false);
assert.strictEqual(validSpeed(5), false);
assert.strictEqual(validRobloxSpeed(1.25), true);
assert.strictEqual(validRobloxSpeed(0), false);
assert.strictEqual(validRobloxSpeed(17), false);

console.log('upload validation tests passed');
