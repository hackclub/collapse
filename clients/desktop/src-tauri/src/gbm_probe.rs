//! Probes GBM (Generic Buffer Management) to detect whether WebKitGTK's
//! hardware-accelerated compositing will work.  If GBM buffer allocation
//! fails (common on certain Arch-based distros like CatchyOS), we
//! preemptively set `WEBKIT_DISABLE_COMPOSITING_MODE=1` so the webview
//! falls back to software rendering instead of crashing with
//! "Gdk Error 71 (Protocol error)".
//!
//! Everything is loaded at runtime via `dlopen` so we don't add a hard
//! link-time dependency on libgbm.

use std::ffi::CString;
use std::os::raw::{c_char, c_int, c_void};

// GBM constants (from <gbm.h>)
const GBM_BO_USE_RENDERING: u32 = 1 << 2;
const GBM_BO_FORMAT_ARGB8888: u32 = 0x34325241; // __gbm_fourcc_code('A','R','2','4')

// Minimal test buffer size — just needs to succeed, not be useful.
const PROBE_WIDTH: u32 = 64;
const PROBE_HEIGHT: u32 = 64;

type GbmDevice = c_void;
type GbmBo = c_void;

/// Attempts to create a small GBM buffer.  Returns `true` if GBM works,
/// `false` if it doesn't (or if libgbm isn't available at all).
fn gbm_buffer_works() -> bool {
    unsafe {
        // dlopen libgbm
        let lib_name = CString::new("libgbm.so.1").unwrap();
        let lib = libc::dlopen(lib_name.as_ptr(), libc::RTLD_NOW);
        if lib.is_null() {
            eprintln!("[gbm-probe] libgbm.so.1 not found, skipping probe");
            return true; // no libgbm → can't test, assume OK
        }

        // Resolve symbols
        macro_rules! sym {
            ($name:expr, $ty:ty) => {{
                let s = CString::new($name).unwrap();
                let p = libc::dlsym(lib, s.as_ptr());
                if p.is_null() {
                    eprintln!("[gbm-probe] symbol {} not found", $name);
                    libc::dlclose(lib);
                    return true; // can't probe, assume OK
                }
                std::mem::transmute::<*mut c_void, $ty>(p)
            }};
        }

        let gbm_create_device: unsafe extern "C" fn(c_int) -> *mut GbmDevice = sym!(
            "gbm_create_device",
            unsafe extern "C" fn(c_int) -> *mut GbmDevice
        );
        let gbm_device_destroy: unsafe extern "C" fn(*mut GbmDevice) =
            sym!("gbm_device_destroy", unsafe extern "C" fn(*mut GbmDevice));
        let gbm_bo_create: unsafe extern "C" fn(*mut GbmDevice, u32, u32, u32, u32) -> *mut GbmBo = sym!(
            "gbm_bo_create",
            unsafe extern "C" fn(*mut GbmDevice, u32, u32, u32, u32) -> *mut GbmBo
        );
        let gbm_bo_destroy: unsafe extern "C" fn(*mut GbmBo) =
            sym!("gbm_bo_destroy", unsafe extern "C" fn(*mut GbmBo));

        // Open the render node
        let render_node = CString::new("/dev/dri/renderD128").unwrap();
        let fd = libc::open(render_node.as_ptr(), libc::O_RDWR);
        if fd < 0 {
            eprintln!("[gbm-probe] cannot open /dev/dri/renderD128, skipping probe");
            libc::dlclose(lib);
            return true; // no render node → can't test
        }

        let device = gbm_create_device(fd);
        if device.is_null() {
            eprintln!("[gbm-probe] gbm_create_device failed");
            libc::close(fd);
            libc::dlclose(lib);
            return false;
        }

        let bo = gbm_bo_create(
            device,
            PROBE_WIDTH,
            PROBE_HEIGHT,
            GBM_BO_FORMAT_ARGB8888,
            GBM_BO_USE_RENDERING,
        );

        let works = !bo.is_null();

        if !bo.is_null() {
            gbm_bo_destroy(bo);
        }
        gbm_device_destroy(device);
        libc::close(fd);
        libc::dlclose(lib);

        works
    }
}

/// Call this before creating the Tauri webview.  If GBM allocation fails,
/// sets the environment variable that tells WebKitGTK to skip the
/// GPU-accelerated DMA-BUF renderer and fall back to software compositing.
pub fn ensure_webview_can_render() {
    if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_ok() {
        // User already set it — respect their choice.
        return;
    }

    if gbm_buffer_works() {
        eprintln!("[gbm-probe] GBM buffer allocation OK, using hardware compositing");
    } else {
        eprintln!(
            "[gbm-probe] GBM buffer allocation failed — disabling WebKitGTK compositing \
             (WEBKIT_DISABLE_COMPOSITING_MODE=1)"
        );
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}
