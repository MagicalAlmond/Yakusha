//! The RGSS runtime hook.
//!
//! Loaded into a running RPG Maker XP / VX / VX Ace game before its main thread
//! starts. The game resolves every RGSS entry point at run time through
//! `GetProcAddress`, so patching that one import in the executable gives us the
//! same reach as a proxy DLL without touching any file on disk:
//!
//! * `RGSSGameMain` is replaced with our wrapper. The wrapper runs the Ruby
//!   bootstrap, then calls the real entry point.
//! * `RGSSEval` is remembered so the bootstrap can execute Ruby inside the
//!   already-initialised VM.
//!
//! Everything else is passed through untouched. The hook never writes to the
//! game directory except for its own log file.

#![allow(non_snake_case, non_camel_case_types, dead_code)]

use std::ffi::{c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

type HINSTANCE = *mut c_void;
type HMODULE = *mut c_void;
type FARPROC = *const c_void;

const DLL_PROCESS_ATTACH: u32 = 1;
const PAGE_EXECUTE_READWRITE: u32 = 0x40;

#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleW(lpModuleName: *const u16) -> HMODULE;
    fn GetModuleFileNameW(hModule: HMODULE, lpFilename: *mut u16, nSize: u32) -> u32;
    fn VirtualProtect(lpAddress: *const c_void, dwSize: usize, flNewProtect: u32, lpflOldProtect: *mut u32) -> i32;
}

static REAL_GET_PROC_ADDRESS: AtomicUsize = AtomicUsize::new(0);
static REAL_RGSS_EVAL: AtomicUsize = AtomicUsize::new(0);
static REAL_RGSS_GAME_MAIN: AtomicUsize = AtomicUsize::new(0);
static BOOTSTRAPPED: AtomicBool = AtomicBool::new(false);

/// Append one line to `yakusha/native/rgss-hook.log` next to the game.
unsafe fn log(message: &str) {
    let Some(root) = game_root() else { return };
    let dir = root.join("yakusha").join("native");
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join("rgss-hook.log");
    use std::io::Write;
    if let Ok(mut handle) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
        let _ = writeln!(handle, "{}", message);
    }
}

/// The directory holding Game.exe (the main module of this process).
unsafe fn game_root() -> Option<PathBuf> {
    let mut buffer = [0u16; 1024];
    let length = GetModuleFileNameW(std::ptr::null_mut(), buffer.as_mut_ptr(), buffer.len() as u32);
    if length == 0 || length as usize >= buffer.len() {
        return None;
    }
    let exe = String::from_utf16_lossy(&buffer[..length as usize]);
    PathBuf::from(exe).parent().map(|p| p.to_path_buf())
}

/// Read a little-endian u32 at `base + offset`.
unsafe fn read_u32(base: *const u8, offset: usize) -> u32 {
    std::ptr::read_unaligned(base.add(offset) as *const u32)
}

/// Read a little-endian u16 at `base + offset`.
unsafe fn read_u16(base: *const u8, offset: usize) -> u16 {
    std::ptr::read_unaligned(base.add(offset) as *const u16)
}

/// Find a NUL-terminated ASCII string at `address`, if it looks printable.
unsafe fn c_string(address: *const u8) -> Option<String> {
    if address.is_null() {
        return None;
    }
    let mut length = 0usize;
    while length < 256 {
        let byte = std::ptr::read(address.add(length));
        if byte == 0 {
            break;
        }
        if byte < 0x20 || byte > 0x7e {
            return None;
        }
        length += 1;
    }
    if length == 0 || length >= 256 {
        return None;
    }
    let slice = std::slice::from_raw_parts(address, length);
    std::str::from_utf8(slice).ok().map(|s| s.to_string())
}

/// Replace GetProcAddress in the main module import table.
unsafe fn install_hook() {
    let module = GetModuleHandleW(std::ptr::null());
    if module.is_null() {
        return;
    }
    let base = module as *const u8;
    let pe_offset = read_u32(base, 0x3c) as usize;
    if read_u16(base, pe_offset) != 0x4550 {
        log("cannot patch: no PE header");
        return;
    }
    let optional = base.add(pe_offset + 24);
    let magic = read_u16(optional, 0);
    if magic != 0x10b {
        log("cannot patch: not a 32-bit image");
        return;
    }
    // Pe32 optional header: data directories start at offset 96; the import
    // directory is the second entry, at offset 104.
    let import_rva = read_u32(optional, 104) as usize;
    if import_rva == 0 {
        log("cannot patch: no import directory");
        return;
    }
    let mut descriptor = base.add(import_rva);
    loop {
        let original_first_thunk = read_u32(descriptor, 0) as usize;
        let name_rva = read_u32(descriptor, 12) as usize;
        let first_thunk = read_u32(descriptor, 16) as usize;
        if original_first_thunk == 0 && name_rva == 0 && first_thunk == 0 {
            break;
        }
        if let Some(name) = c_string(base.add(name_rva)) {
            if name.to_ascii_lowercase().starts_with("kernel32") {
                let mut index = 0usize;
                loop {
                    let thunk = base.add(if original_first_thunk != 0 { original_first_thunk } else { first_thunk });
                    let value = read_u32(thunk, index * 4);
                    if value == 0 {
                        break;
                    }
                    if value & 0x80000000 == 0 {
                        let by_name = base.add(value as usize);
                        if let Some(function) = c_string(by_name.add(2)) {
                            if function.eq_ignore_ascii_case("GetProcAddress") {
                                let slot = base.add(first_thunk + index * 4) as *mut u32;
                                let old = std::ptr::read_unaligned(slot);
                                REAL_GET_PROC_ADDRESS.store(old as usize, Ordering::SeqCst);
                                let mut old_protect = 0u32;
                                VirtualProtect(slot as *const c_void, 4, PAGE_EXECUTE_READWRITE, &mut old_protect);
                                std::ptr::write_unaligned(slot, hook_get_proc_address as usize as u32);
                                VirtualProtect(slot as *const c_void, 4, old_protect, &mut old_protect);
                                log(&format!("patched kernel32!GetProcAddress at {:p}", slot));
                                return;
                            }
                        }
                    }
                    index += 1;
                }
            }
        }
        descriptor = descriptor.add(20);
    }
    log("cannot patch: GetProcAddress import not found");
}

/// The GetProcAddress replacement. Only RGSS names are special-cased.
unsafe extern "system" fn hook_get_proc_address(module: HMODULE, name: *const u8) -> FARPROC {
    let real_address = REAL_GET_PROC_ADDRESS.load(Ordering::SeqCst);
    if real_address == 0 || name.is_null() {
        return std::ptr::null();
    }
    let real: unsafe extern "system" fn(HMODULE, *const u8) -> FARPROC = std::mem::transmute(real_address);
    let result = real(module, name);
    let text = CStr::from_ptr(name as *const i8).to_string_lossy();
    match text.as_ref() {
        "RGSSEval" => {
            REAL_RGSS_EVAL.store(result as usize, Ordering::SeqCst);
            log("resolved RGSSEval");
        }
        "RGSSGameMain" => {
            REAL_RGSS_GAME_MAIN.store(result as usize, Ordering::SeqCst);
            log("resolved RGSSGameMain, returning the wrapper");
            return rgss_game_main as FARPROC;
        }
        _ => {}
    }
    result
}

/// Run the Ruby bootstrap once, then hand control to the real RGSSGameMain.
unsafe extern "cdecl" fn rgss_game_main(a: usize, b: usize, c: usize) -> usize {
    run_bootstrap();
    let address = REAL_RGSS_GAME_MAIN.load(Ordering::SeqCst);
    if address == 0 {
        log("RGSSGameMain was not resolved; returning 0");
        return 0;
    }
    let real: unsafe extern "cdecl" fn(usize, usize, usize) -> usize = std::mem::transmute(address);
    real(a, b, c)
}

/// Evaluate `yakusha/native/bootstrap.rb` through the game's own RGSSEval.
unsafe fn run_bootstrap() {
    if BOOTSTRAPPED.swap(true, Ordering::SeqCst) {
        return;
    }
    let eval_address = REAL_RGSS_EVAL.load(Ordering::SeqCst);
    if eval_address == 0 {
        log("bootstrap skipped: RGSSEval was not resolved");
        return;
    }
    let Some(root) = game_root() else {
        log("bootstrap skipped: no game root");
        return;
    };
    let script = root.join("yakusha").join("native").join("bootstrap.rb");
    let Ok(source) = std::fs::read_to_string(&script) else {
        log(&format!("bootstrap skipped: cannot read {}", script.display()));
        return;
    };
    let quoted = root.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
    let source = format!("YAKUSHA_ROOT = \"{}\"\n{}", quoted, source);
    let length = source.len();
    log(&format!("bootstrap file {} bytes at {}", length, script.display()));
    let Ok(code) = CString::new(source) else {
        log("bootstrap skipped: source contains a NUL byte");
        return;
    };
    let eval: unsafe extern "cdecl" fn(*const u8) -> i32 = std::mem::transmute(eval_address);
    let result = eval(code.as_ptr() as *const u8);
    log(&format!("bootstrap {} chars -> {}", code.as_bytes().len().saturating_sub(1), result));
}

#[no_mangle]
pub extern "system" fn DllMain(_instance: HINSTANCE, reason: u32, _reserved: *mut c_void) -> i32 {
    if reason == DLL_PROCESS_ATTACH {
        unsafe {
            log("DLL attached");
            install_hook();
        }
    }
    1
}
