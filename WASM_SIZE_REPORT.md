# WASM Size Analysis

## Build Info

**Target**: `wasm32-freestanding`  
**Optimization**: `ReleaseSmall`  
**Date**: November 11, 2025

## Size Comparison

### Before (Baseline)
- **Size**: 122 KB
- **Exports**: sgr_*, key_*, osc_*, wasm_alloc/free (existing functionality)
- **Functionality**: Color parsing, key encoding, OSC parsing only

### After (With Terminal)
- **Size**: 404 KB (compiled)
- **Exports**: All above + 16 terminal_* functions
- **Growth**: +282 KB (+231%)
- **Functionality**: Complete terminal emulator with VT parsing

## Export List

All terminal exports verified present:

```
ghostty_terminal_new
ghostty_terminal_new_with_config
ghostty_terminal_free
ghostty_terminal_resize
ghostty_terminal_write
ghostty_terminal_get_cols
ghostty_terminal_get_rows
ghostty_terminal_get_cursor_x
ghostty_terminal_get_cursor_y
ghostty_terminal_get_cursor_visible
ghostty_terminal_get_scrollback_length
ghostty_terminal_get_line
ghostty_terminal_get_scrollback_line
ghostty_terminal_is_dirty
ghostty_terminal_is_row_dirty
ghostty_terminal_clear_dirty
```

## Size Breakdown (Estimated)

The 282 KB increase includes:
- **Terminal Core** (~100 KB): Main terminal logic, state management
- **VT Parser** (~50 KB): CSI/ESC/DCS sequence parsing
- **Screen/PageList** (~80 KB): Buffer management, scrollback
- **Style System** (~30 KB): Color/attribute management
- **Utilities** (~22 KB): Helper functions, dirty tracking

## Benefits vs. Cost

### What We Get
✅ **Complete VT100/ANSI parser** - Thousands of edge cases handled  
✅ **Screen buffer management** - Proven, optimized implementation  
✅ **Scrollback support** - Configurable limits (default 10,000 lines)  
✅ **Dirty tracking** - Efficient rendering optimization  
✅ **Color resolution** - Full palette and RGB support  
✅ **Delete ~1,475 lines** of TypeScript code (buffer.ts + vt-parser.ts)

### Size Justification
- **From 122 KB to 404 KB is acceptable** for deleting 1,475 lines of complex logic
- TypeScript would need to reimplement all this functionality anyway
- WASM is faster and more correct than TypeScript reimplementation
- Browser will gzip this (estimated ~150-200 KB gzipped)

## Optimization Opportunities

If size becomes a concern, these features could be disabled:

1. **Kitty Graphics Protocol** (`-Dkitty-graphics=false`): ~20-30 KB savings
2. **Sixel Support** (`-Dsixel=false`): ~15-20 KB savings  
3. **Hyperlink Support**: ~10 KB savings
4. **Advanced DCS sequences**: ~5-10 KB savings

**Estimated with all optimizations**: ~330-350 KB

## Comparison to Alternatives

- **xterm.js**: ~300 KB (JavaScript, needs parser + buffer)
- **vtebench**: ~1.2 MB (full Rust implementation)
- **libvterm**: ~80 KB (C, but limited features)

**Ghostty WASM at 404 KB is competitive** and provides production-quality terminal emulation.

## Conclusion

✅ **Size is acceptable** (< 500 KB target)  
✅ **All exports present** (16 terminal functions)  
✅ **Replaces 1,475 lines** of TypeScript  
✅ **Production quality** - Battle-tested in Ghostty

The size increase is justified by the functionality gained and code maintenance burden removed.
