/**
 * @file terminal.h
 *
 * Complete terminal emulator API for WASM integration.
 */

#ifndef GHOSTTY_VT_TERMINAL_H
#define GHOSTTY_VT_TERMINAL_H

/** @defgroup terminal Terminal Emulator
 *
 * Complete terminal emulator with VT100/ANSI parsing and screen buffer management.
 *
 * This API exports Ghostty's production-tested terminal emulator for use in
 * WASM environments. It handles all VT sequence parsing, screen buffer management,
 * scrollback, cursor positioning, and text styling.
 *
 * ## Basic Usage
 *
 * 1. Create a terminal with ghostty_terminal_new()
 * 2. Write data with ghostty_terminal_write() (parses VT sequences)
 * 3. Read screen content with ghostty_terminal_get_line()
 * 4. Query cursor position with ghostty_terminal_get_cursor_x/y()
 * 5. Free with ghostty_terminal_free() when done
 *
 * ## Example
 *
 * @code{.c}
 * #include <ghostty/vt.h>
 * #include <string.h>
 *
 * int main() {
 *   // Create 80x24 terminal
 *   GhosttyTerminal term = ghostty_terminal_new(80, 24);
 *   if (!term) return 1;
 *
 *   // Write some text with color
 *   const char* data = "Hello \x1b[31mRed\x1b[0m World!";
 *   ghostty_terminal_write(term, (const uint8_t*)data, strlen(data));
 *
 *   // Read first line
 *   GhosttyCell cells[80];
 *   int count = ghostty_terminal_get_line(term, 0, cells, 80);
 *
 *   // Check cursor position
 *   int x = ghostty_terminal_get_cursor_x(term);
 *   int y = ghostty_terminal_get_cursor_y(term);
 *
 *   // Cleanup
 *   ghostty_terminal_free(term);
 *   return 0;
 * }
 * @endcode
 *
 * @{
 */

#include <ghostty/vt/allocator.h>
#include <ghostty/vt/result.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Opaque terminal handle.
 *
 * Represents a terminal emulator instance. Create with ghostty_terminal_new()
 * and free with ghostty_terminal_free().
 */
typedef void* GhosttyTerminal;

/**
 * Terminal configuration options.
 *
 * Used when creating a new terminal to specify behavior and limits.
 */
typedef struct {
    /**
     * Maximum scrollback lines (0 = unlimited, default = 10000).
     *
     * Limits memory usage by restricting how many lines of history are kept.
     * For WASM environments, a reasonable limit is recommended.
     */
    uint32_t scrollback_limit;

    /**
     * Initial foreground color (RGB, 0xRRGGBB format, 0 = use default).
     */
    uint32_t fg_color;

    /**
     * Initial background color (RGB, 0xRRGGBB format, 0 = use default).
     */
    uint32_t bg_color;
} GhosttyTerminalConfig;

/**
 * Cell structure - represents a single character position.
 *
 * This is designed to be simple and C-compatible. Colors are always
 * exported as RGB (terminal color palette is resolved internally).
 *
 * Size: 16 bytes (efficient for bulk transfers across WASM boundary)
 */
typedef struct {
    /** Unicode codepoint (0 = empty cell) */
    uint32_t codepoint;

    /** Foreground color - Red component (0-255) */
    uint8_t fg_r;
    /** Foreground color - Green component (0-255) */
    uint8_t fg_g;
    /** Foreground color - Blue component (0-255) */
    uint8_t fg_b;

    /** Background color - Red component (0-255) */
    uint8_t bg_r;
    /** Background color - Green component (0-255) */
    uint8_t bg_g;
    /** Background color - Blue component (0-255) */
    uint8_t bg_b;

    /** Style flags (see GHOSTTY_CELL_* constants) */
    uint8_t flags;

    /** Character width: 0=combining, 1=normal, 2=wide (CJK) */
    uint8_t width;
} GhosttyCell;

/** Cell flag: Bold text */
#define GHOSTTY_CELL_BOLD          (1 << 0)
/** Cell flag: Italic text */
#define GHOSTTY_CELL_ITALIC        (1 << 1)
/** Cell flag: Underlined text */
#define GHOSTTY_CELL_UNDERLINE     (1 << 2)
/** Cell flag: Strikethrough text */
#define GHOSTTY_CELL_STRIKETHROUGH (1 << 3)
/** Cell flag: Inverse video (swap fg/bg) */
#define GHOSTTY_CELL_INVERSE       (1 << 4)
/** Cell flag: Invisible text */
#define GHOSTTY_CELL_INVISIBLE     (1 << 5)
/** Cell flag: Blinking text */
#define GHOSTTY_CELL_BLINK         (1 << 6)
/** Cell flag: Faint/dim text */
#define GHOSTTY_CELL_FAINT         (1 << 7)

/* ============================================================================
 * Lifecycle Management
 * ========================================================================= */

/**
 * Create a new terminal instance with default configuration.
 *
 * Creates an 80x24 terminal with default settings (10,000 line scrollback,
 * standard color palette, autowrap enabled).
 *
 * @param cols Number of columns (typically 80, minimum 1)
 * @param rows Number of rows (typically 24, minimum 1)
 * @return Terminal handle, or NULL on allocation failure
 *
 * @see ghostty_terminal_new_with_config() for custom configuration
 * @see ghostty_terminal_free()
 */
GhosttyTerminal ghostty_terminal_new(int cols, int rows);

/**
 * Create a new terminal instance with custom configuration.
 *
 * @param cols Number of columns (typically 80, minimum 1)
 * @param rows Number of rows (typically 24, minimum 1)
 * @param config Configuration options (NULL = use defaults)
 * @return Terminal handle, or NULL on allocation failure
 *
 * @see ghostty_terminal_new()
 * @see ghostty_terminal_free()
 */
GhosttyTerminal ghostty_terminal_new_with_config(
    int cols,
    int rows,
    const GhosttyTerminalConfig* config
);

/**
 * Free a terminal instance.
 *
 * Releases all memory associated with the terminal. The handle becomes
 * invalid after this call.
 *
 * @param term Terminal to free (NULL is safe)
 */
void ghostty_terminal_free(GhosttyTerminal term);

/**
 * Resize the terminal.
 *
 * Changes the terminal dimensions. Content is preserved where possible,
 * with appropriate reflowing or truncation.
 *
 * @param term Terminal instance
 * @param cols New column count (minimum 1)
 * @param rows New row count (minimum 1)
 */
void ghostty_terminal_resize(GhosttyTerminal term, int cols, int rows);

/* ============================================================================
 * Input/Output
 * ========================================================================= */

/**
 * Write data to terminal (parses VT sequences and updates screen).
 *
 * This is the main entry point - all terminal output goes through here.
 * The data is parsed as VT100/ANSI escape sequences and the screen
 * buffer is updated accordingly.
 *
 * Supports:
 * - Text output (UTF-8)
 * - CSI sequences (colors, cursor movement, etc.)
 * - OSC sequences (title, colors, etc.)
 * - All standard VT100/xterm sequences
 *
 * @param term Terminal instance
 * @param data UTF-8 encoded data (may contain VT sequences)
 * @param len Length of data in bytes
 *
 * @note This function marks affected rows as dirty for rendering optimization
 */
void ghostty_terminal_write(GhosttyTerminal term, const uint8_t* data, size_t len);

/* ============================================================================
 * Screen Queries
 * ========================================================================= */

/**
 * Get terminal width in columns.
 *
 * @param term Terminal instance
 * @return Number of columns, or 0 if term is NULL
 */
int ghostty_terminal_get_cols(GhosttyTerminal term);

/**
 * Get terminal height in rows.
 *
 * @param term Terminal instance
 * @return Number of rows, or 0 if term is NULL
 */
int ghostty_terminal_get_rows(GhosttyTerminal term);

/**
 * Get cursor X position (column).
 *
 * @param term Terminal instance
 * @return Column position (0-indexed), or 0 if term is NULL
 */
int ghostty_terminal_get_cursor_x(GhosttyTerminal term);

/**
 * Get cursor Y position (row).
 *
 * @param term Terminal instance
 * @return Row position (0-indexed), or 0 if term is NULL
 */
int ghostty_terminal_get_cursor_y(GhosttyTerminal term);

/**
 * Get cursor visibility state.
 *
 * @param term Terminal instance
 * @return true if cursor is visible, false otherwise
 */
bool ghostty_terminal_get_cursor_visible(GhosttyTerminal term);

/**
 * Get scrollback length (number of lines in history).
 *
 * @param term Terminal instance
 * @return Number of scrollback lines, or 0 if none/NULL
 */
int ghostty_terminal_get_scrollback_length(GhosttyTerminal term);

/* ============================================================================
 * Cell Data Access
 * ========================================================================= */

/**
 * Get a line of cells from the visible screen.
 *
 * Retrieves an entire row of cells at once for efficient rendering.
 * Colors are returned as RGB values (palette indices are resolved).
 *
 * @param term Terminal instance
 * @param y Line number (0-indexed, 0 = top visible line)
 * @param out_buffer Output buffer (must have space for at least 'cols' cells)
 * @param buffer_size Size of output buffer in cells (should be >= cols)
 * @return Number of cells written (equals cols on success), or -1 on error
 *
 * @note Always writes exactly 'cols' cells, padding with empty cells if needed
 */
int ghostty_terminal_get_line(
    GhosttyTerminal term,
    int y,
    GhosttyCell* out_buffer,
    size_t buffer_size
);

/**
 * Get a line from scrollback history.
 *
 * @param term Terminal instance
 * @param y Line number (0 = oldest scrollback line)
 * @param out_buffer Output buffer
 * @param buffer_size Size of output buffer in cells
 * @return Number of cells written, or -1 on error/not implemented
 *
 * @note Currently not implemented - returns -1
 */
int ghostty_terminal_get_scrollback_line(
    GhosttyTerminal term,
    int y,
    GhosttyCell* out_buffer,
    size_t buffer_size
);

/* ============================================================================
 * Dirty Tracking (for efficient rendering)
 * ========================================================================= */

/**
 * Check if any part of the screen is dirty.
 *
 * Dirty tracking helps optimize rendering by identifying what changed.
 * After writing to the terminal, check which rows are dirty and only
 * re-render those.
 *
 * @param term Terminal instance
 * @return true if any row needs redrawing, false otherwise
 *
 * @see ghostty_terminal_is_row_dirty()
 * @see ghostty_terminal_clear_dirty()
 */
bool ghostty_terminal_is_dirty(GhosttyTerminal term);

/**
 * Check if a specific row is dirty.
 *
 * @param term Terminal instance
 * @param y Row number (0-indexed)
 * @return true if row needs redrawing, false otherwise
 */
bool ghostty_terminal_is_row_dirty(GhosttyTerminal term, int y);

/**
 * Clear all dirty flags (call after rendering).
 *
 * After reading dirty rows and re-rendering them, call this to mark
 * the screen as clean.
 *
 * @param term Terminal instance
 */
void ghostty_terminal_clear_dirty(GhosttyTerminal term);

#ifdef __cplusplus
}
#endif

/** @} */

#endif /* GHOSTTY_VT_TERMINAL_H */
