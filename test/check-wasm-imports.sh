#!/bin/bash
# Check what imports the WASM module requires

echo "Checking WASM imports for zig-out/bin/ghostty-vt.wasm"
echo ""

if command -v wasm-objdump &> /dev/null; then
    echo "Using wasm-objdump:"
    wasm-objdump -x zig-out/bin/ghostty-vt.wasm | grep -A 20 "Import\["
elif command -v wasm2wat &> /dev/null; then
    echo "Using wasm2wat:"
    wasm2wat zig-out/bin/ghostty-vt.wasm | grep -A 5 "import"
else
    echo "⚠️  WABT tools not found. Install with:"
    echo "  - Ubuntu/Debian: apt install wabt"
    echo "  - macOS: brew install wabt"
    echo "  - Or download from: https://github.com/WebAssembly/wabt"
    echo ""
    echo "For now, the WASM module requires:"
    echo "  - env.log (for std.log output)"
    echo ""
    echo "The test harness in test/wasm-terminal-test.mjs provides these."
fi
