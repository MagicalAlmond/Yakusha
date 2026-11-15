/*
 * Yakusha portable launcher.
 *
 * Windows 11 builds in the 26100/26200 series can terminate Electron's
 * sandboxed child processes with STATUS_BREAKPOINT (0x80000003) before the
 * main window appears.  The Electron main process itself may also fail to
 * start.  On those machines the app only starts with --no-sandbox.
 *
 * This launcher keeps the normal sandbox as the first attempt.  It only
 * retries with --no-sandbox when the runtime exits with the two crash codes
 * that match the known Chromium sandbox startup failure.  The retry is
 * deliberately narrow: a normal exit and an ordinary application error do
 * not disable the sandbox.
 *
 * The launcher is a tiny native GUI program built with llvm-mingw.  It has
 * no console window and no runtime dependency.
 */
#include <windows.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>
#include <wctype.h>

#define LAUNCHER_TIMEOUT_MS 15000u
#define CRASH_STATUS_BREAKPOINT 0x80000003u
#define CRASH_STATUS_ACCESS_VIOLATION 0xC0000005u

static BOOL append_text(wchar_t *dst, size_t cap, const wchar_t *text) {
  size_t used = wcslen(dst);
  size_t add = wcslen(text);
  if (used + add + 1 > cap) return FALSE;
  wcscpy(dst + used, text);
  return TRUE;
}

static BOOL make_command_line(wchar_t *out, size_t cap, const wchar_t *runtime,
                              const wchar_t *extra, const wchar_t *rest) {
  out[0] = L'\0';
  if (!append_text(out, cap, L"\"")) return FALSE;
  if (!append_text(out, cap, runtime)) return FALSE;
  if (!append_text(out, cap, L"\"")) return FALSE;
  if (extra && *extra) {
    if (!append_text(out, cap, L" ")) return FALSE;
    if (!append_text(out, cap, extra)) return FALSE;
  }
  if (rest && *rest) {
    if (!append_text(out, cap, L" ")) return FALSE;
    if (!append_text(out, cap, rest)) return FALSE;
  }
  return TRUE;
}

static const wchar_t *arguments_after_program(void) {
  const wchar_t *p = GetCommandLineW();
  if (*p == L'"') {
    p++;
    while (*p && *p != L'"') p++;
    if (*p == L'"') p++;
  } else {
    while (*p && !iswspace((wint_t)*p)) p++;
  }
  while (*p && iswspace((wint_t)*p)) p++;
  return p;
}

typedef struct {
  DWORD pid;
  BOOL found;
} WINDOW_SEARCH;

static BOOL CALLBACK find_window(HWND hwnd, LPARAM lparam) {
  WINDOW_SEARCH *search = (WINDOW_SEARCH *)lparam;
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid == search->pid && IsWindowVisible(hwnd) &&
      GetWindow(hwnd, GW_OWNER) == NULL) {
    search->found = TRUE;
    return FALSE;
  }
  return TRUE;
}

static BOOL has_visible_window(DWORD pid) {
  WINDOW_SEARCH search;
  search.pid = pid;
  search.found = FALSE;
  EnumWindows(find_window, (LPARAM)&search);
  return search.found;
}

/* TRUE means the process exited; FALSE means it is still running. */
static BOOL wait_for_window_or_exit(HANDLE process, DWORD pid) {
  DWORD start = GetTickCount();
  for (;;) {
    DWORD wait = WaitForSingleObject(process, 100);
    if (wait == WAIT_OBJECT_0) return TRUE;
    if (has_visible_window(pid)) return FALSE;
    if (GetTickCount() - start >= LAUNCHER_TIMEOUT_MS) return FALSE;
  }
}

static DWORD run_runtime(const wchar_t *runtime, const wchar_t *workdir,
                         const wchar_t *extra, const wchar_t *rest,
                         HANDLE *process_out) {
  wchar_t command[32768];
  if (!make_command_line(command, sizeof(command) / sizeof(command[0]),
                         runtime, extra, rest)) {
    return ERROR_BUFFER_OVERFLOW;
  }
  STARTUPINFOW startup;
  PROCESS_INFORMATION info;
  ZeroMemory(&startup, sizeof(startup));
  startup.cb = sizeof(startup);
  ZeroMemory(&info, sizeof(info));
  if (!CreateProcessW(runtime, command, NULL, NULL, FALSE, 0, NULL, workdir,
                      &startup, &info)) {
    return GetLastError();
  }
  CloseHandle(info.hThread);
  if (process_out) {
    *process_out = info.hProcess;
  } else {
    CloseHandle(info.hProcess);
  }
  return ERROR_SUCCESS;
}

static void show_error(const wchar_t *message) {
  MessageBoxW(NULL, message, L"Yakusha", MB_OK | MB_ICONERROR);
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command_line,
                   int show_command) {
  (void)instance;
  (void)previous;
  (void)command_line;
  (void)show_command;

  SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX |
               SEM_NOOPENFILEERRORBOX);
  /* This harness may set ELECTRON_RUN_AS_NODE; a double-clicked GUI must not
     inherit it. */
  SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", NULL);

  wchar_t module[32768];
  DWORD module_length = GetModuleFileNameW(NULL, module, 32768);
  if (module_length == 0 || module_length >= 32768) {
    show_error(L"Cannot locate the Yakusha launcher.");
    return 1;
  }
  wchar_t *slash = wcsrchr(module, L'\\');
  if (slash == NULL) {
    show_error(L"Cannot locate the Yakusha launcher directory.");
    return 1;
  }
  *slash = L'\0';

  wchar_t runtime[32768];
  runtime[0] = L'\0';
  if (!append_text(runtime, 32768, module) ||
      !append_text(runtime, 32768, L"\\yakusha-runtime.exe")) {
    show_error(L"The Yakusha runtime path is too long.");
    return 1;
  }
  if (GetFileAttributesW(runtime) == INVALID_FILE_ATTRIBUTES) {
    show_error(L"yakusha-runtime.exe is missing. Re-extract the portable folder.");
    return 1;
  }

  const wchar_t *rest = arguments_after_program();
  HANDLE process = NULL;
  DWORD error = run_runtime(runtime, module, NULL, rest, &process);
  if (error != ERROR_SUCCESS) {
    show_error(L"Cannot start the Yakusha runtime.");
    return 1;
  }

  if (!wait_for_window_or_exit(process, GetProcessId(process))) {
    /* A window appeared, or the process is still starting. Leave it alone. */
    CloseHandle(process);
    return 0;
  }

  DWORD exit_code = 0;
  GetExitCodeProcess(process, &exit_code);
  CloseHandle(process);
  if (exit_code != CRASH_STATUS_BREAKPOINT &&
      exit_code != CRASH_STATUS_ACCESS_VIOLATION) {
    return (int)exit_code;
  }

  /* The known Windows sandbox startup crash: retry once without the
     Chromium sandbox. */
  error = run_runtime(runtime, module, L"--no-sandbox", rest, NULL);
  if (error != ERROR_SUCCESS) {
    show_error(L"Cannot restart the Yakusha runtime.");
    return 1;
  }
  return 0;
}
