# Ghostty WASM Terminal API - Usage Guide

## Overview

This document describes how to use the WASM-exported Terminal API in JavaScript/TypeScript applications.

## Quick Start

```javascript
import fs from 'fs';

// Load WASM module
const wasmBinary = fs.readFileSync('./ghostty-vt.wasm');

// Provide required imports
const imports = {
  env: {
    // Logging function (required by std.log in WASM)
    log: (level, scope_ptr, scope_len, msg_ptr, msg_len) => {
      // Can be empty for production, or implement for debugging
    }
  }
};

const wasmModule = await WebAssembly.instantiate(wasmBinary, imports);

const { exports } = wasmModule.instance;
const { memory } = exports;

// Create terminal (80x24)
const term = exports.ghostty_terminal_new(80, 24);

// Write some text
const encoder = new TextEncoder();
const data = encoder.encode("Hello, World!\n");
const ptr = exports.ghostty_wasm_alloc_u8_array(data.length);
new Uint8Array(memory.buffer).set(data, ptr);
exports.ghostty_terminal_write(term, ptr, data.length);
exports.ghostty_wasm_free_u8_array(ptr, data.length);

// Read first line
const cellSize = 16; // sizeof(GhosttyCell)
const cols = exports.ghostty_terminal_get_cols(term);
const linePtr = exports.ghostty_wasm_alloc_u8_array(cols * cellSize);
exports.ghostty_terminal_get_line(term, 0, linePtr, cols);

// Parse cells
const view = new DataView(memory.buffer, linePtr, cols * cellSize);
for (let i = 0; i < cols; i++) {
  const offset = i * cellSize;
  const codepoint = view.getUint32(offset, true);
  const fg_r = view.getUint8(offset + 4);
  // ... read other fields
  console.log(String.fromCodePoint(codepoint));
}

// Cleanup
exports.ghostty_wasm_free_u8_array(linePtr, cols * cellSize);
exports.ghostty_terminal_free(term);
```

## API Reference

### Lifecycle

#### `ghostty_terminal_new(cols: i32, rows: i32) -> ptr`
Creates a new terminal with default configuration (10,000 line scrollback, default colors).

#### `ghostty_terminal_new_with_config(cols: i32, rows: i32, config: ptr) -> ptr`
Creates a terminal with custom configuration.

Config structure (12 bytes):
```c
struct {
  scrollback_limit: u32,  // 0 = unlimited
  fg_color: u32,          // RGB: 0xRRGGBB, 0 = use default
  bg_color: u32,          // RGB: 0xRRGGBB, 0 = use default
}
```

#### `ghostty_terminal_free(term: ptr)`
Frees all memory associated with the terminal.

#### `ghostty_terminal_resize(term: ptr, cols: i32, rows: i32)`
Resizes the terminal, preserving content where possible.

### Input/Output

#### `ghostty_terminal_write(term: ptr, data: ptr, len: usize)`
Writes UTF-8 data to the terminal. Parses all VT100/ANSI escape sequences and updates the screen buffer.

**Example**:
```javascript
const text = "\x1b[31mRed text\x1b[0m Normal";
const bytes = encoder.encode(text);
const ptr = exports.ghostty_wasm_alloc_u8_array(bytes.length);
new Uint8Array(memory.buffer).set(bytes, ptr);
exports.ghostty_terminal_write(term, ptr, bytes.length);
exports.ghostty_wasm_free_u8_array(ptr, bytes.length);
```

### Screen Queries

#### `ghostty_terminal_get_cols(term: ptr) -> i32`
Returns terminal width in columns.

#### `ghostty_terminal_get_rows(term: ptr) -> i32`
Returns terminal height in rows.

#### `ghostty_terminal_get_cursor_x(term: ptr) -> i32`
Returns cursor column (0-indexed).

#### `ghostty_terminal_get_cursor_y(term: ptr) -> i32`
Returns cursor row (0-indexed).

#### `ghostty_terminal_get_cursor_visible(term: ptr) -> bool`
Returns whether the cursor should be visible.

#### `ghostty_terminal_get_scrollback_length(term: ptr) -> i32`
Returns number of lines in scrollback history.

### Cell Data

#### `ghostty_terminal_get_line(term: ptr, y: i32, buffer: ptr, buffer_size: usize) -> i32`
Reads an entire line from the visible screen into `buffer`.

**Parameters**:
- `y`: Row number (0-indexed, 0 = top visible line)
- `buffer`: Pointer to buffer with space for `cols * 16` bytes
- `buffer_size`: Size in number of cells (should be >= cols)

**Returns**: Number of cells written (equals cols), or -1 on error

**Cell Structure (16 bytes)**:
```
Offset  Type   Field
------  -----  ---------------
0       u32    codepoint (Unicode)
4       u8     fg_r (0-255)
5       u8     fg_g (0-255)
6       u8     fg_b (0-255)
7       u8     bg_r (0-255)
8       u8     bg_g (0-255)
9       u8     bg_b (0-255)
10      u8     flags (bitfield)
11      u8     width (0=combining, 1=normal, 2=wide)
12-15   -      (padding)
```

**Flags Bitfield**:
```
Bit  Meaning
---  ---------------
0    Bold
1    Italic
2    Underline
3    Strikethrough
4    Inverse video
5    Invisible
6    Blink
7    Faint/dim
```

### Dirty Tracking

#### `ghostty_terminal_is_dirty(term: ptr) -> bool`
Returns true if any row needs re-rendering.

#### `ghostty_terminal_is_row_dirty(term: ptr, y: i32) -> bool`
Returns true if specific row needs re-rendering.

#### `ghostty_terminal_clear_dirty(term: ptr)`
Marks all rows as clean. Call after rendering.

**Usage Pattern**:
```javascript
// After terminal write
if (exports.ghostty_terminal_is_dirty(term)) {
  const rows = exports.ghostty_terminal_get_rows(term);
  for (let y = 0; y < rows; y++) {
    if (exports.ghostty_terminal_is_row_dirty(term, y)) {
      // Re-render row y
      const cells = getLine(term, y);
      render(y, cells);
    }
  }
  exports.ghostty_terminal_clear_dirty(term);
}
```

## Helper: Cell Reader Class

```javascript
class CellReader {
  constructor(memory, ptr, count) {
    this.view = new DataView(memory.buffer, ptr, count * 16);
    this.count = count;
  }

  getCell(index) {
    const offset = index * 16;
    return {
      codepoint: this.view.getUint32(offset, true),
      fg: {
        r: this.view.getUint8(offset + 4),
        g: this.view.getUint8(offset + 5),
        b: this.view.getUint8(offset + 6),
      },
      bg: {
        r: this.view.getUint8(offset + 7),
        g: this.view.getUint8(offset + 8),
        b: this.view.getUint8(offset + 9),
      },
      flags: this.view.getUint8(offset + 10),
      width: this.view.getUint8(offset + 11),
    };
  }

  getText() {
    let text = '';
    for (let i = 0; i < this.count; i++) {
      const cell = this.getCell(i);
      if (cell.codepoint > 0) {
        text += String.fromCodePoint(cell.codepoint);
      }
    }
    return text;
  }
}
```

## Performance Tips

1. **Batch writes**: Accumulate data and write in larger chunks
2. **Dirty tracking**: Only re-render rows that changed
3. **Reuse buffers**: Allocate cell buffers once and reuse
4. **Avoid cell-by-cell access**: Always read full lines

## Error Handling

Functions return sentinel values on error:
- Pointers: `0` (NULL)
- Integers: `-1` or `0` depending on context
- Booleans: `false`

No exceptions are thrown from WASM.

## Memory Management

**Important**: Always free allocated memory!

```javascript
// Allocate
const ptr = exports.ghostty_wasm_alloc_u8_array(size);

// Use ptr...

// Free
exports.ghostty_wasm_free_u8_array(ptr, size);
```

The terminal itself owns its memory - only call `ghostty_terminal_free()` when done.

## Next Steps

See `test/wasm-terminal-test.mjs` for complete working examples.
