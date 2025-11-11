//! C API wrapper for Terminal
//!
//! This provides a C-compatible interface to Ghostty's Terminal for WASM export.

const std = @import("std");
const Allocator = std.mem.Allocator;
const assert = std.debug.assert;
const builtin = @import("builtin");

const Terminal = @import("../Terminal.zig");
const ReadonlyStream = @import("../stream_readonly.zig").Stream;
const size = @import("../size.zig");
const pagepkg = @import("../page.zig");
const Cell = pagepkg.Cell;
const PageList = @import("../PageList.zig");
const color = @import("../color.zig");
const point = @import("../point.zig");
const style = @import("../style.zig");

const log = std.log.scoped(.terminal_c);

/// Wrapper struct that owns both the Terminal and its allocator.
/// This is what we return as an opaque pointer to C.
const TerminalWrapper = struct {
    /// The allocator that owns all terminal memory
    alloc: Allocator,
    
    /// The terminal instance
    terminal: Terminal,
    
    /// Stream for processing VT sequences
    stream: ReadonlyStream,
    
    /// Dirty tracking - which rows have changed since last clear
    dirty_rows: []bool,
    
    /// Configuration used for terminal
    config: Config,
    
    const Config = struct {
        scrollback_limit: u32,
        fg_color: u32,
        bg_color: u32,
    };
};

/// C-compatible cell structure
pub const GhosttyCell = extern struct {
    codepoint: u32,
    fg_r: u8,
    fg_g: u8,
    fg_b: u8,
    bg_r: u8,
    bg_g: u8,
    bg_b: u8,
    flags: u8,
    width: u8,
};

/// C-compatible terminal configuration
pub const GhosttyTerminalConfig = extern struct {
    scrollback_limit: u32,
    fg_color: u32,
    bg_color: u32,
};

// ============================================================================
// Lifecycle Management
// ============================================================================

pub fn new(cols: c_int, rows: c_int) callconv(.c) ?*anyopaque {
    return newWithConfig(cols, rows, null);
}

pub fn newWithConfig(
    cols: c_int,
    rows: c_int,
    config_: ?*const GhosttyTerminalConfig,
) callconv(.c) ?*anyopaque {
    // Use WASM allocator for WASM builds, GPA otherwise
    const alloc = if (builtin.target.cpu.arch.isWasm())
        std.heap.wasm_allocator
    else
        std.heap.c_allocator;
    
    // Parse configuration
    const config: TerminalWrapper.Config = if (config_) |cfg| .{
        .scrollback_limit = cfg.scrollback_limit,
        .fg_color = cfg.fg_color,
        .bg_color = cfg.bg_color,
    } else .{
        .scrollback_limit = 10_000,
        .fg_color = 0,
        .bg_color = 0,
    };
    
    // Allocate wrapper
    const wrapper = alloc.create(TerminalWrapper) catch |err| {
        log.err("Failed to allocate TerminalWrapper: {}", .{err});
        return null;
    };
    
    // Setup terminal colors
    var colors = Terminal.Colors.default;
    if (config.fg_color != 0) {
        const rgb = color.RGB{
            .r = @truncate((config.fg_color >> 16) & 0xFF),
            .g = @truncate((config.fg_color >> 8) & 0xFF),
            .b = @truncate(config.fg_color & 0xFF),
        };
        colors.foreground = color.DynamicRGB.init(rgb);
    }
    if (config.bg_color != 0) {
        const rgb = color.RGB{
            .r = @truncate((config.bg_color >> 16) & 0xFF),
            .g = @truncate((config.bg_color >> 8) & 0xFF),
            .b = @truncate(config.bg_color & 0xFF),
        };
        colors.background = color.DynamicRGB.init(rgb);
    }
    
    // Create terminal
    var terminal = Terminal.init(
        alloc,
        .{
            .cols = @intCast(cols),
            .rows = @intCast(rows),
            .max_scrollback = if (config.scrollback_limit == 0)
                std.math.maxInt(usize)
            else
                config.scrollback_limit,
            .colors = colors,
        },
    ) catch |err| {
        log.err("Failed to initialize Terminal: {}", .{err});
        alloc.destroy(wrapper);
        return null;
    };
    
    // Create stream for VT processing
    const stream = terminal.vtStream();
    
    // Allocate dirty tracking
    const rows_usize: usize = @intCast(rows);
    const dirty_rows = alloc.alloc(bool, rows_usize) catch |err| {
        log.err("Failed to allocate dirty tracking: {}", .{err});
        // Note: terminal.deinit() requires the allocator be passed
        var term_mut = terminal;
        term_mut.deinit(alloc);
        alloc.destroy(wrapper);
        return null;
    };
    @memset(dirty_rows, true); // Initially all dirty
    
    wrapper.* = .{
        .alloc = alloc,
        .terminal = terminal,
        .stream = stream,
        .dirty_rows = dirty_rows,
        .config = config,
    };
    
    return @ptrCast(wrapper);
}

pub fn free(ptr: ?*anyopaque) callconv(.c) void {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return));
    const alloc = wrapper.alloc;
    
    alloc.free(wrapper.dirty_rows);
    wrapper.terminal.deinit(alloc);
    alloc.destroy(wrapper);
}

pub fn resize(ptr: ?*anyopaque, cols: c_int, rows: c_int) callconv(.c) void {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return));
    
    // Resize terminal
    wrapper.terminal.resize(
        wrapper.alloc,
        @intCast(cols),
        @intCast(rows),
    ) catch |err| {
        log.err("Resize failed: {}", .{err});
        return;
    };
    
    // Reallocate dirty tracking
    const rows_usize: usize = @intCast(rows);
    const new_dirty = wrapper.alloc.realloc(wrapper.dirty_rows, rows_usize) catch |err| {
        log.err("Failed to reallocate dirty tracking: {}", .{err});
        return;
    };
    wrapper.dirty_rows = new_dirty;
    @memset(new_dirty, true); // All dirty after resize
}

// ============================================================================
// Input/Output
// ============================================================================

pub fn write(ptr: ?*anyopaque, data: [*]const u8, len: usize) callconv(.c) void {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return));
    
    // Write data to terminal stream (this parses VT sequences)
    const slice = data[0..len];
    wrapper.stream.nextSlice(slice) catch |err| {
        log.err("Write failed: {}", .{err});
        return;
    };
    
    // Mark all visible rows as dirty (conservative approach)
    @memset(wrapper.dirty_rows, true);
}

// ============================================================================
// Screen Queries
// ============================================================================

pub fn getCols(ptr: ?*anyopaque) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    return @intCast(wrapper.terminal.cols);
}

pub fn getRows(ptr: ?*anyopaque) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    return @intCast(wrapper.terminal.rows);
}

pub fn getCursorX(ptr: ?*anyopaque) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    return @intCast(wrapper.terminal.screen.cursor.x);
}

pub fn getCursorY(ptr: ?*anyopaque) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    return @intCast(wrapper.terminal.screen.cursor.y);
}

pub fn getCursorVisible(ptr: ?*anyopaque) callconv(.c) bool {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return false));
    // Check if cursor is visible based on modes
    return wrapper.terminal.modes.get(.cursor_visible);
}

pub fn getScrollbackLength(ptr: ?*anyopaque) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    // Calculate scrollback length as difference between history top and active top
    const active_pin = wrapper.terminal.screen.pages.getTopLeft(.active);
    const screen_pin = wrapper.terminal.screen.pages.getTopLeft(.screen);
    
    // Count rows between screen top and active top
    var count: c_int = 0;
    var pin = screen_pin;
    while (pin.node != active_pin.node or pin.y != active_pin.y) {
        count += 1;
        pin = pin.down(1) orelse break;
        if (count > 100000) break; // Safety limit
    }
    return count;
}

// ============================================================================
// Cell Data Access
// ============================================================================

/// Convert Ghostty's internal Cell to C-compatible GhosttyCell
/// list_cell_opt can be null if we're using a default empty cell  
fn convertCell(wrapper: *const TerminalWrapper, cell: Cell, list_cell_opt: @TypeOf(wrapper.terminal.screen.pages.getCell(.{.viewport = .{}}))) GhosttyCell {
    const terminal = &wrapper.terminal;
    const palette = &terminal.colors.palette.current;
    
    // Get codepoint
    const cp = cell.content.codepoint;
    
    // Get the style - either from the page or use default
    const cell_style: style.Style = if (cell.style_id == style.default_id)
        .{}
    else if (list_cell_opt) |list_cell|
        list_cell.node.data.styles.get(list_cell.node.data.memory, cell.style_id).*
    else
        .{};
    
    // Resolve foreground color
    const fg_rgb: color.RGB = fg: {
        switch (cell_style.fg_color) {
            .none => {
                // Use default foreground
                if (terminal.colors.foreground.get()) |rgb| {
                    break :fg rgb;
                } else {
                    // Default to white
                    break :fg .{ .r = 0xEA, .g = 0xEA, .b = 0xEA };
                }
            },
            .palette => |idx| break :fg palette[idx],
            .rgb => |rgb| break :fg rgb,
        }
    };
    
    // Resolve background color
    const bg_rgb: color.RGB = bg: {
        // Check for cell-level color override
        if (cell_style.bg(&cell, palette)) |rgb| {
            break :bg rgb;
        }
        
        // Use default background
        if (terminal.colors.background.get()) |rgb| {
            break :bg rgb;
        } else {
            // Default to black
            break :bg .{ .r = 0x1D, .g = 0x1F, .b = 0x21 };
        }
    };
    
    // Build flags bitfield
    var flags: u8 = 0;
    if (cell_style.flags.bold) flags |= 1 << 0;
    if (cell_style.flags.italic) flags |= 1 << 1;
    if (cell_style.flags.underline != .none) flags |= 1 << 2;
    if (cell_style.flags.strikethrough) flags |= 1 << 3;
    if (cell_style.flags.inverse) flags |= 1 << 4;
    if (cell_style.flags.invisible) flags |= 1 << 5;
    if (cell_style.flags.blink) flags |= 1 << 6;
    if (cell_style.flags.faint) flags |= 1 << 7;
    
    return .{
        .codepoint = cp,
        .fg_r = fg_rgb.r,
        .fg_g = fg_rgb.g,
        .fg_b = fg_rgb.b,
        .bg_r = bg_rgb.r,
        .bg_g = bg_rgb.g,
        .bg_b = bg_rgb.b,
        .flags = flags,
        .width = @intFromEnum(cell.wide),
    };
}

pub fn getLine(
    ptr: ?*anyopaque,
    y: c_int,
    out_buffer: [*]GhosttyCell,
    buffer_size: usize,
) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return -1));
    
    const y_usize: usize = @intCast(y);
    if (y_usize >= wrapper.terminal.rows) return -1;
    
    const cols = wrapper.terminal.cols;
    if (buffer_size < cols) return -1;
    
    // Get cells from the screen using viewport coordinates
    var x: usize = 0;
    while (x < cols) : (x += 1) {
        const pt = point.Point{ .viewport = .{
            .x = @intCast(x),
            .y = @intCast(y),
        } };
        
        const list_cell = wrapper.terminal.screen.pages.getCell(pt);
        const cell = if (list_cell) |lc| lc.cell.* else Cell{};
        out_buffer[x] = convertCell(wrapper, cell, list_cell);
    }
    
    return @intCast(cols);
}

pub fn getScrollbackLine(
    ptr: ?*anyopaque,
    y: c_int,
    out_buffer: [*]GhosttyCell,
    buffer_size: usize,
) callconv(.c) c_int {
    // Not implemented - scrollback access is deferred to Phase 2
    _ = ptr;
    _ = y;
    _ = out_buffer;
    _ = buffer_size;
    return -1;
}

// ============================================================================
// Dirty Tracking
// ============================================================================

pub fn isDirty(ptr: ?*anyopaque) callconv(.c) bool {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return false));
    
    for (wrapper.dirty_rows) |dirty| {
        if (dirty) return true;
    }
    return false;
}

pub fn isRowDirty(ptr: ?*anyopaque, y: c_int) callconv(.c) bool {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return false));
    
    const y_usize: usize = @intCast(y);
    if (y_usize >= wrapper.dirty_rows.len) return false;
    
    return wrapper.dirty_rows[y_usize];
}

pub fn clearDirty(ptr: ?*anyopaque) callconv(.c) void {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return));
    @memset(wrapper.dirty_rows, false);
}

// ============================================================================
// Tests
// ============================================================================

test "terminal lifecycle" {
    const term = new(80, 24);
    defer free(term);
    
    try std.testing.expect(term != null);
    try std.testing.expectEqual(@as(c_int, 80), getCols(term));
    try std.testing.expectEqual(@as(c_int, 24), getRows(term));
}

test "terminal write and read" {
    const term = new(80, 24);
    defer free(term);
    
    // Write "Hello"
    const data = "Hello";
    write(term, data.ptr, data.len);
    
    // Read first line
    var cells: [80]GhosttyCell = undefined;
    const count = getLine(term, 0, &cells, 80);
    try std.testing.expectEqual(@as(c_int, 80), count);
    
    // Check first few characters
    try std.testing.expectEqual(@as(u32, 'H'), cells[0].codepoint);
    try std.testing.expectEqual(@as(u32, 'e'), cells[1].codepoint);
    try std.testing.expectEqual(@as(u32, 'l'), cells[2].codepoint);
    try std.testing.expectEqual(@as(u32, 'l'), cells[3].codepoint);
    try std.testing.expectEqual(@as(u32, 'o'), cells[4].codepoint);
}

test "terminal cursor position" {
    const term = new(80, 24);
    defer free(term);
    
    // Initially at 0, 0
    try std.testing.expectEqual(@as(c_int, 0), getCursorX(term));
    try std.testing.expectEqual(@as(c_int, 0), getCursorY(term));
    
    // Write "Hello" (5 chars)
    const data = "Hello";
    write(term, data.ptr, data.len);
    
    // Cursor should have moved
    try std.testing.expectEqual(@as(c_int, 5), getCursorX(term));
    try std.testing.expectEqual(@as(c_int, 0), getCursorY(term));
}

test "terminal dirty tracking" {
    const term = new(80, 24);
    defer free(term);
    
    // Initially dirty
    try std.testing.expect(isDirty(term));
    
    // Clear dirty
    clearDirty(term);
    try std.testing.expect(!isDirty(term));
    
    // Write makes it dirty again
    const data = "X";
    write(term, data.ptr, data.len);
    try std.testing.expect(isDirty(term));
    try std.testing.expect(isRowDirty(term, 0));
}
