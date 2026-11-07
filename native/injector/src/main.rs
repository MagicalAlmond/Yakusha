//! The 32-bit injector shipped with the RGSS runtime.
//!
//! Usage: `yakusha_injector.exe --game <Game.exe> --dll <hook.dll>`
//!
//! It creates the game suspended, loads the hook DLL through a remote thread,
//! then resumes the main thread. The game keeps running after the injector
//! exits; the game's own working directory and command line are preserved.
//!
//! The hook DLL is not self-contained: the gnullvm target links the Rust
//! unwinder dynamically, so `libunwind.dll` sits next to it in
//! `yakusha/native`. Windows resolves a DLL's own imports through the
//! *application* directory (the game folder), not through the folder of the
//! DLL being loaded, so a plain LoadLibraryW fails with ERROR_MOD_NOT_FOUND
//! even though the file is right there. The injector therefore points the
//! process at the hook's folder with SetDllDirectoryW first. Any failure after
//! the game was created terminates it, so a failed launch never leaves a
//! suspended process behind.

#![allow(non_snake_case, non_camel_case_types)]

use std::ffi::{c_void, OsStr};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::ptr::null_mut;

type HANDLE = *mut c_void;
type HMODULE = *mut c_void;
type FARPROC = *const c_void;

const CREATE_SUSPENDED: u32 = 0x0000_0004;
const MEM_COMMIT: u32 = 0x0000_1000;
const MEM_RESERVE: u32 = 0x0000_2000;
const PAGE_READWRITE: u32 = 0x04;
const INFINITE: u32 = 0xffff_ffff;

#[repr(C)]
struct StartupInfoW {
    cb: u32,
    lpReserved: *mut u16,
    lpDesktop: *mut u16,
    lpTitle: *mut u16,
    dwX: u32,
    dwY: u32,
    dwXSize: u32,
    dwYSize: u32,
    dwXCountChars: u32,
    dwYCountChars: u32,
    dwFillAttribute: u32,
    dwFlags: u32,
    wShowWindow: u16,
    cbReserved2: u16,
    lpReserved2: *mut u8,
    hStdInput: HANDLE,
    hStdOutput: HANDLE,
    hStdError: HANDLE,
}

#[repr(C)]
struct ProcessInformation {
    hProcess: HANDLE,
    hThread: HANDLE,
    dwProcessId: u32,
    dwThreadId: u32,
}

#[link(name = "kernel32")]
extern "system" {
    fn CreateProcessW(
        lpApplicationName: *const u16,
        lpCommandLine: *mut u16,
        lpProcessAttributes: *const c_void,
        lpThreadAttributes: *const c_void,
        bInheritHandles: i32,
        dwCreationFlags: u32,
        lpEnvironment: *const c_void,
        lpCurrentDirectory: *const u16,
        lpStartupInfo: *const StartupInfoW,
        lpProcessInformation: *mut ProcessInformation,
    ) -> i32;
    fn VirtualAllocEx(hProcess: HANDLE, lpAddress: *const c_void, dwSize: usize, flAllocationType: u32, flProtect: u32) -> *mut c_void;
    fn WriteProcessMemory(hProcess: HANDLE, lpBaseAddress: *mut c_void, lpBuffer: *const c_void, nSize: usize, lpNumberOfBytesWritten: *mut usize) -> i32;
    fn CreateRemoteThread(
        hProcess: HANDLE,
        lpThreadAttributes: *const c_void,
        dwStackSize: usize,
        lpStartAddress: unsafe extern "system" fn(*mut c_void) -> u32,
        lpParameter: *mut c_void,
        dwCreationFlags: u32,
        lpThreadId: *mut u32,
    ) -> HANDLE;
    fn WaitForSingleObject(hHandle: HANDLE, dwMilliseconds: u32) -> u32;
    fn GetExitCodeThread(hThread: HANDLE, lpExitCode: *mut u32) -> i32;
    fn ResumeThread(hThread: HANDLE) -> u32;
    fn TerminateProcess(hProcess: HANDLE, uExitCode: u32) -> i32;
    fn CloseHandle(hObject: HANDLE) -> i32;
    fn GetModuleHandleW(lpModuleName: *const u16) -> HMODULE;
    fn GetProcAddress(hModule: HMODULE, lpProcName: *const u8) -> FARPROC;
}

fn wide(value: &OsStr) -> Vec<u16> {
    let mut text: Vec<u16> = value.encode_wide().collect();
    text.push(0);
    text
}

fn fail(message: &str) -> ! {
    eprintln!("error: {}", message);
    std::process::exit(1);
}

/// Terminate the game we started, then report. A failed launch must not leave
/// a suspended, half-created process behind.
fn fail_process(process: &ProcessInformation, message: &str) -> ! {
    unsafe {
        TerminateProcess(process.hProcess, 1);
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
    }
    fail(message)
}

fn absolute(value: PathBuf) -> PathBuf {
    if value.is_absolute() {
        value
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(&value))
            .unwrap_or(value)
    }
}

fn value_of(args: &[String], flag: &str) -> Option<String> {
    let index = args.iter().position(|value| value == flag)?;
    args.get(index + 1).cloned()
}

/// Copy one NUL-terminated string into the target process. The allocation is
/// deliberately never freed: the game owns the process, and a few hundred
/// bytes are cheaper than another remote call that could fail.
fn write_remote(process: &ProcessInformation, text: &[u16]) -> *mut c_void {
    let bytes = text.len() * 2;
    let remote = unsafe {
        VirtualAllocEx(process.hProcess, null_mut(), bytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE)
    };
    if remote.is_null() {
        fail_process(
            process,
            &format!("VirtualAllocEx failed: {}", std::io::Error::last_os_error()),
        );
    }
    let mut written = 0usize;
    let ok = unsafe {
        WriteProcessMemory(
            process.hProcess,
            remote,
            text.as_ptr() as *const c_void,
            bytes,
            &mut written,
        )
    };
    if ok == 0 || written != bytes {
        fail_process(
            process,
            &format!("WriteProcessMemory failed: {}", std::io::Error::last_os_error()),
        );
    }
    remote
}

/// Run one one-argument function inside the game and return its result.
fn remote_call(process: &ProcessInformation, start: *mut c_void, param: *mut c_void) -> u32 {
    let entry: unsafe extern "system" fn(*mut c_void) -> u32 = unsafe { std::mem::transmute(start) };
    let thread = unsafe { CreateRemoteThread(process.hProcess, null_mut(), 0, entry, param, 0, null_mut()) };
    if thread.is_null() {
        fail_process(
            process,
            &format!("CreateRemoteThread failed: {}", std::io::Error::last_os_error()),
        );
    }
    unsafe { WaitForSingleObject(thread, INFINITE) };
    let mut code = 0u32;
    unsafe {
        GetExitCodeThread(thread, &mut code);
        CloseHandle(thread);
    }
    code
}

fn proc_address(module: HMODULE, name: &[u8]) -> *mut c_void {
    if module.is_null() {
        return null_mut();
    }
    unsafe { GetProcAddress(module, name.as_ptr()) as *mut c_void }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let Some(game) = value_of(&args, "--game") else {
        fail("missing --game <Game.exe>");
    };
    let Some(dll) = value_of(&args, "--dll") else {
        fail("missing --dll <hook.dll>");
    };
    let game_path = absolute(PathBuf::from(&game));
    let dll_path = absolute(PathBuf::from(&dll));
    if !game_path.is_file() {
        fail(&format!("game executable does not exist: {}", game_path.display()));
    }
    if !dll_path.is_file() {
        fail(&format!("hook DLL does not exist: {}", dll_path.display()));
    }
    let working_directory = game_path.parent().unwrap_or_else(|| Path::new("."));
    let dll_directory = dll_path.parent().unwrap_or_else(|| Path::new("."));

    let application = wide(game_path.as_os_str());
    let mut command_line = wide(game_path.as_os_str());
    let current = wide(working_directory.as_os_str());
    let dll_wide = wide(dll_path.as_os_str());
    let dir_wide = wide(dll_directory.as_os_str());

    let mut startup: StartupInfoW = unsafe { std::mem::zeroed() };
    startup.cb = std::mem::size_of::<StartupInfoW>() as u32;
    let mut process: ProcessInformation = unsafe { std::mem::zeroed() };
    let created = unsafe {
        CreateProcessW(
            application.as_ptr(),
            command_line.as_mut_ptr(),
            null_mut(),
            null_mut(),
            0,
            CREATE_SUSPENDED,
            null_mut(),
            current.as_ptr(),
            &startup,
            &mut process,
        )
    };
    if created == 0 {
        fail(&format!("CreateProcessW failed: {}", std::io::Error::last_os_error()));
    }

    let remote_dll = write_remote(&process, &dll_wide);
    let remote_dir = write_remote(&process, &dir_wide);

    let kernel32_name = wide(OsStr::new("kernel32.dll"));
    let kernel32 = unsafe { GetModuleHandleW(kernel32_name.as_ptr()) };
    let set_dll_directory = proc_address(kernel32, b"SetDllDirectoryW\0");
    let load_library = proc_address(kernel32, b"LoadLibraryW\0");
    if set_dll_directory.is_null() {
        fail_process(&process, "cannot resolve SetDllDirectoryW");
    }
    if load_library.is_null() {
        fail_process(&process, "cannot resolve LoadLibraryW");
    }

    // Point the process at the hook's folder so its own imports (libunwind.dll)
    // resolve. The game's application directory is searched first either way.
    let directed = remote_call(&process, set_dll_directory, remote_dir);
    if directed == 0 {
        fail_process(&process, "SetDllDirectoryW failed in the game process");
    }

    let module = remote_call(&process, load_library, remote_dll);
    if module == 0 {
        fail_process(
            &process,
            "the hook DLL could not be loaded into the game (libunwind.dll must sit next to it)",
        );
    }

    let resumed = unsafe { ResumeThread(process.hThread) };
    if resumed == u32::MAX {
        fail_process(
            &process,
            &format!("ResumeThread failed: {}", std::io::Error::last_os_error()),
        );
    }
    println!("pid={}", process.dwProcessId);
    unsafe {
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
    }
}
