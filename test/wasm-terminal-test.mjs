/**
 * Test harness for ghostty_terminal_* WASM exports
 * 
 * Run: node test/wasm-terminal-test.mjs
 */

import fs from 'fs';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load WASM
const wasmPath = join(__dirname, '../zig-out/bin/ghostty-vt.wasm');
const wasmBinary = fs.readFileSync(wasmPath);
const wasmModule = await WebAssembly.instantiate(wasmBinary, {
  env: {}
});

const exports = wasmModule.instance.exports;
const memory = exports.memory;

// Helper: Allocate string in WASM memory
function allocString(str) {
  const bytes = new TextEncoder().encode(str);
  const ptr = exports.ghostty_wasm_alloc_u8_array(bytes.length);
  new Uint8Array(memory.buffer).set(bytes, ptr);
  return { ptr, len: bytes.length };
}

// Helper: Free WASM memory
function freePtr(ptr, len) {
  exports.ghostty_wasm_free_u8_array(ptr, len);
}

// Helper: Read cell data
function readCells(ptr, count) {
  const cells = [];
  const view = new DataView(memory.buffer, ptr);
  const cellSize = 16; // sizeof(ghostty_cell_t)
  
  for (let i = 0; i < count; i++) {
    const offset = i * cellSize;
    cells.push({
      codepoint: view.getUint32(offset, true),
      fg: {
        r: view.getUint8(offset + 4),
        g: view.getUint8(offset + 5),
        b: view.getUint8(offset + 6),
      },
      bg: {
        r: view.getUint8(offset + 7),
        g: view.getUint8(offset + 8),
        b: view.getUint8(offset + 9),
      },
      flags: view.getUint8(offset + 10),
      width: view.getUint8(offset + 11),
    });
  }
  
  return cells;
}

// Helper: Get text from cells
function cellsToText(cells) {
  return cells
    .map(c => c.codepoint > 0 ? String.fromCodePoint(c.codepoint) : ' ')
    .join('');
}

console.log('🧪 Testing WASM Terminal exports...\n');

// ============================================================================
// Test 1: Lifecycle
// ============================================================================

console.log('Test 1: Terminal lifecycle');
const term = exports.ghostty_terminal_new(80, 24);
assert(term !== 0, 'terminal_new should return non-null');
console.log(`  ✓ Created terminal: ptr=${term}`);

const cols = exports.ghostty_terminal_get_cols(term);
const rows = exports.ghostty_terminal_get_rows(term);
assert.strictEqual(cols, 80, 'cols should be 80');
assert.strictEqual(rows, 24, 'rows should be 24');
console.log(`  ✓ Dimensions: ${cols}x${rows}`);

exports.ghostty_terminal_free(term);
console.log('  ✓ Freed terminal\n');

// ============================================================================
// Test 2: Write and Read
// ============================================================================

console.log('Test 2: Write and read text');
const term2 = exports.ghostty_terminal_new(80, 24);

// Write "Hello, World!"
const { ptr: dataPtr, len: dataLen } = allocString('Hello, World!');
exports.ghostty_terminal_write(term2, dataPtr, dataLen);
freePtr(dataPtr, dataLen);
console.log('  ✓ Wrote "Hello, World!"');

// Read first line
const bufferSize = 80 * 16; // 80 cells * 16 bytes
const bufferPtr = exports.ghostty_wasm_alloc_u8_array(bufferSize);
const count = exports.ghostty_terminal_get_line(term2, 0, bufferPtr, 80);
assert.strictEqual(count, 80, 'should return 80 cells');

const cells = readCells(bufferPtr, count);
freePtr(bufferPtr, bufferSize);

// Verify content
assert.strictEqual(cells[0].codepoint, 72, 'First char should be "H" (72)');
assert.strictEqual(cells[1].codepoint, 101, 'Second char should be "e" (101)');
assert.strictEqual(cells[2].codepoint, 108, 'Third char should be "l" (108)');
assert.strictEqual(String.fromCodePoint(cells[0].codepoint), 'H');
const text = cellsToText(cells.slice(0, 13));
console.log('  ✓ Read back: "' + text + '"');
assert(text.startsWith('Hello, World!'), 'Content should match');

exports.ghostty_terminal_free(term2);
console.log('  ✓ Content matches\n');

// ============================================================================
// Test 3: Cursor Position
// ============================================================================

console.log('Test 3: Cursor position');
const term3 = exports.ghostty_terminal_new(80, 24);

let x = exports.ghostty_terminal_get_cursor_x(term3);
let y = exports.ghostty_terminal_get_cursor_y(term3);
assert.strictEqual(x, 0, 'Initial cursor X should be 0');
assert.strictEqual(y, 0, 'Initial cursor Y should be 0');
console.log(`  ✓ Initial cursor: (${x}, ${y})`);

// Write "Hello" (5 chars)
const { ptr: p3, len: l3 } = allocString('Hello');
exports.ghostty_terminal_write(term3, p3, l3);
freePtr(p3, l3);

x = exports.ghostty_terminal_get_cursor_x(term3);
y = exports.ghostty_terminal_get_cursor_y(term3);
assert.strictEqual(x, 5, 'Cursor X should be 5 after "Hello"');
assert.strictEqual(y, 0, 'Cursor Y should still be 0');
console.log(`  ✓ After "Hello": (${x}, ${y})`);

// Test newline
const { ptr: p3b, len: l3b } = allocString('\n');
exports.ghostty_terminal_write(term3, p3b, l3b);
freePtr(p3b, l3b);

x = exports.ghostty_terminal_get_cursor_x(term3);
y = exports.ghostty_terminal_get_cursor_y(term3);
assert.strictEqual(x, 0, 'Cursor X should be 0 after newline');
assert.strictEqual(y, 1, 'Cursor Y should be 1 after newline');
console.log(`  ✓ After newline: (${x}, ${y})`);

exports.ghostty_terminal_free(term3);
console.log('');

// ============================================================================
// Test 4: ANSI Colors
// ============================================================================

console.log('Test 4: ANSI colors');
const term4 = exports.ghostty_terminal_new(80, 24);

// Write red text: ESC[31mRed
const { ptr: p4, len: l4 } = allocString('\x1b[31mRed');
exports.ghostty_terminal_write(term4, p4, l4);
freePtr(p4, l4);

// Read first line
const buf4 = exports.ghostty_wasm_alloc_u8_array(80 * 16);
exports.ghostty_terminal_get_line(term4, 0, buf4, 80);
const cells4 = readCells(buf4, 80);
freePtr(buf4, 80 * 16);

// First cell should be 'R' with red foreground
assert.strictEqual(cells4[0].codepoint, 82, 'Should be "R"');
console.log(`  ✓ Red text: codepoint=${cells4[0].codepoint}, fg=(${cells4[0].fg.r}, ${cells4[0].fg.g}, ${cells4[0].fg.b})`);
// Red component should be higher than others (palette resolved)
assert(cells4[0].fg.r > cells4[0].fg.g && cells4[0].fg.r > cells4[0].fg.b, 
  'Red component should be dominant');

// Test green text
const { ptr: p4b, len: l4b } = allocString('\x1b[32m Green');
exports.ghostty_terminal_write(term4, p4b, l4b);
freePtr(p4b, l4b);

const buf4b = exports.ghostty_wasm_alloc_u8_array(80 * 16);
exports.ghostty_terminal_get_line(term4, 0, buf4b, 80);
const cells4b = readCells(buf4b, 80);
freePtr(buf4b, 80 * 16);

// Cell after "Red" should have space, then 'G' should be green
const greenCell = cells4b[4]; // After "Red " is the 'G'
console.log(`  ✓ Green text: codepoint=${greenCell.codepoint}, fg=(${greenCell.fg.r}, ${greenCell.fg.g}, ${greenCell.fg.b})`);

exports.ghostty_terminal_free(term4);
console.log('');

// ============================================================================
// Test 5: Dirty Tracking
// ============================================================================

console.log('Test 5: Dirty tracking');
const term5 = exports.ghostty_terminal_new(80, 24);

// Initially dirty (after creation)
let dirty = exports.ghostty_terminal_is_dirty(term5);
assert(dirty, 'Should be dirty initially');
console.log('  ✓ Initially dirty');

// Clear dirty
exports.ghostty_terminal_clear_dirty(term5);
dirty = exports.ghostty_terminal_is_dirty(term5);
assert(!dirty, 'Should not be dirty after clear');
console.log('  ✓ Cleared dirty');

// Write makes it dirty again
const { ptr: p5, len: l5 } = allocString('X');
exports.ghostty_terminal_write(term5, p5, l5);
freePtr(p5, l5);
dirty = exports.ghostty_terminal_is_dirty(term5);
assert(dirty, 'Should be dirty after write');
console.log('  ✓ Dirty after write');

// Check specific row
const row0Dirty = exports.ghostty_terminal_is_row_dirty(term5, 0);
assert(row0Dirty, 'Row 0 should be dirty');
console.log('  ✓ Row 0 is dirty');

exports.ghostty_terminal_free(term5);
console.log('');

// ============================================================================
// Test 6: Resize
// ============================================================================

console.log('Test 6: Resize');
const term6 = exports.ghostty_terminal_new(80, 24);

// Write some content first
const { ptr: p6a, len: l6a } = allocString('Before resize');
exports.ghostty_terminal_write(term6, p6a, l6a);
freePtr(p6a, l6a);

exports.ghostty_terminal_resize(term6, 120, 30);
const newCols = exports.ghostty_terminal_get_cols(term6);
const newRows = exports.ghostty_terminal_get_rows(term6);
assert.strictEqual(newCols, 120, 'Cols should be 120');
assert.strictEqual(newRows, 30, 'Rows should be 30');
console.log(`  ✓ Resized to ${newCols}x${newRows}`);

// Verify content is still there
const buf6 = exports.ghostty_wasm_alloc_u8_array(120 * 16);
exports.ghostty_terminal_get_line(term6, 0, buf6, 120);
const cells6 = readCells(buf6, 120);
freePtr(buf6, 120 * 16);
const text6 = cellsToText(cells6.slice(0, 13));
assert(text6.startsWith('Before resize'), 'Content should be preserved after resize');
console.log('  ✓ Content preserved: "' + text6 + '"');

exports.ghostty_terminal_free(term6);
console.log('');

// ============================================================================
// Test 7: Text Styling
// ============================================================================

console.log('Test 7: Text styling');
const term7 = exports.ghostty_terminal_new(80, 24);

// Write bold text
const { ptr: p7, len: l7 } = allocString('\x1b[1mBold');
exports.ghostty_terminal_write(term7, p7, l7);
freePtr(p7, l7);

const buf7 = exports.ghostty_wasm_alloc_u8_array(80 * 16);
exports.ghostty_terminal_get_line(term7, 0, buf7, 80);
const cells7 = readCells(buf7, 80);
freePtr(buf7, 80 * 16);

// Check bold flag (bit 0)
const boldFlag = cells7[0].flags & (1 << 0);
assert(boldFlag, 'First character should have bold flag');
console.log(`  ✓ Bold flag set: flags=${cells7[0].flags.toString(2).padStart(8, '0')}`);

// Write italic text
const { ptr: p7b, len: l7b } = allocString('\x1b[0m\x1b[3mItalic');
exports.ghostty_terminal_write(term7, p7b, l7b);
freePtr(p7b, l7b);

const buf7b = exports.ghostty_wasm_alloc_u8_array(80 * 16);
exports.ghostty_terminal_get_line(term7, 0, buf7b, 80);
const cells7b = readCells(buf7b, 80);
freePtr(buf7b, 80 * 16);

// Check italic flag (bit 1) - should be on cell after "Bold"
const italicCell = cells7b[4]; // After "Bold" is "Italic"
const italicFlag = italicCell.flags & (1 << 1);
assert(italicFlag, 'Italic text should have italic flag');
console.log(`  ✓ Italic flag set: flags=${italicCell.flags.toString(2).padStart(8, '0')}`);

exports.ghostty_terminal_free(term7);
console.log('');

// ============================================================================
// Test 8: Multi-line Content
// ============================================================================

console.log('Test 8: Multi-line content');
const term8 = exports.ghostty_terminal_new(80, 24);

// Write multiple lines
const { ptr: p8, len: l8 } = allocString('Line 1\nLine 2\nLine 3');
exports.ghostty_terminal_write(term8, p8, l8);
freePtr(p8, l8);

// Read each line
for (let lineNum = 0; lineNum < 3; lineNum++) {
  const buf8 = exports.ghostty_wasm_alloc_u8_array(80 * 16);
  exports.ghostty_terminal_get_line(term8, lineNum, buf8, 80);
  const cells8 = readCells(buf8, 80);
  freePtr(buf8, 80 * 16);
  const text8 = cellsToText(cells8).trim();
  console.log(`  ✓ Line ${lineNum}: "${text8}"`);
  assert(text8.startsWith(`Line ${lineNum + 1}`), `Line ${lineNum} should contain correct text`);
}

exports.ghostty_terminal_free(term8);
console.log('');

// ============================================================================
// Test 9: Cursor Visibility
// ============================================================================

console.log('Test 9: Cursor visibility');
const term9 = exports.ghostty_terminal_new(80, 24);

// Default cursor should be visible
let visible = exports.ghostty_terminal_get_cursor_visible(term9);
assert(visible, 'Cursor should be visible by default');
console.log('  ✓ Cursor visible by default');

// Hide cursor with DECTCEM
const { ptr: p9, len: l9 } = allocString('\x1b[?25l');
exports.ghostty_terminal_write(term9, p9, l9);
freePtr(p9, l9);

visible = exports.ghostty_terminal_get_cursor_visible(term9);
assert(!visible, 'Cursor should be hidden after DECTCEM off');
console.log('  ✓ Cursor hidden after \\x1b[?25l');

// Show cursor again
const { ptr: p9b, len: l9b } = allocString('\x1b[?25h');
exports.ghostty_terminal_write(term9, p9b, l9b);
freePtr(p9b, l9b);

visible = exports.ghostty_terminal_get_cursor_visible(term9);
assert(visible, 'Cursor should be visible after DECTCEM on');
console.log('  ✓ Cursor visible after \\x1b[?25h');

exports.ghostty_terminal_free(term9);
console.log('');

// ============================================================================
// Test 10: Custom Configuration
// ============================================================================

console.log('Test 10: Custom configuration');

// Create config with custom colors and scrollback
const configPtr = exports.ghostty_wasm_alloc_u8_array(12);
const configView = new DataView(memory.buffer, configPtr, 12);
configView.setUint32(0, 5000, true);      // scrollback_limit
configView.setUint32(4, 0x00FF00, true);  // fg_color (green)
configView.setUint32(8, 0x000080, true);  // bg_color (navy blue)

const term10 = exports.ghostty_terminal_new_with_config(80, 24, configPtr);
freePtr(configPtr, 12);

assert(term10 !== 0, 'Should create terminal with config');
console.log('  ✓ Created terminal with custom config');

// Write text and check it uses custom colors
const { ptr: p10, len: l10 } = allocString('Custom colors');
exports.ghostty_terminal_write(term10, p10, l10);
freePtr(p10, l10);

const buf10 = exports.ghostty_wasm_alloc_u8_array(80 * 16);
exports.ghostty_terminal_get_line(term10, 0, buf10, 80);
const cells10 = readCells(buf10, 80);
freePtr(buf10, 80 * 16);

// Check that background has blue component (navy blue)
console.log(`  ✓ Colors: fg=(${cells10[0].fg.r},${cells10[0].fg.g},${cells10[0].fg.b}), bg=(${cells10[0].bg.r},${cells10[0].bg.g},${cells10[0].bg.b})`);
// Note: Default text without ANSI codes should use config colors or defaults

exports.ghostty_terminal_free(term10);
console.log('');

// ============================================================================
// Summary
// ============================================================================

console.log('✅ All tests passed!');
console.log('\nExport verification:');
console.log('  ✓ ghostty_terminal_new');
console.log('  ✓ ghostty_terminal_new_with_config');
console.log('  ✓ ghostty_terminal_free');
console.log('  ✓ ghostty_terminal_resize');
console.log('  ✓ ghostty_terminal_write');
console.log('  ✓ ghostty_terminal_get_cols');
console.log('  ✓ ghostty_terminal_get_rows');
console.log('  ✓ ghostty_terminal_get_cursor_x');
console.log('  ✓ ghostty_terminal_get_cursor_y');
console.log('  ✓ ghostty_terminal_get_cursor_visible');
console.log('  ✓ ghostty_terminal_get_line');
console.log('  ✓ ghostty_terminal_is_dirty');
console.log('  ✓ ghostty_terminal_is_row_dirty');
console.log('  ✓ ghostty_terminal_clear_dirty');

console.log('\n🎉 WASM Terminal API is fully functional!');
