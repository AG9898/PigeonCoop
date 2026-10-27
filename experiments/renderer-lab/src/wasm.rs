//! Bulk local-memory sampling boundary; no per-actor IPC or workflow authority.
use std::cell::RefCell;
thread_local! { static FRAME: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) }; }
#[no_mangle]
pub extern "C" fn sample_frame(time_ms: u32, count: u32, scenario: u32, reduced: u32) -> *const u8 {
    let name = match scenario {
        0 => "normal",
        1 => "stale",
        2 => "cancelled",
        3 => "failure",
        _ => "stale",
    };
    let scene = crate::sample_scene(time_ms, count.clamp(2, 100) as usize, name, reduced != 0);
    FRAME.with(|frame| {
        let mut bytes = frame.borrow_mut();
        *bytes = serde_json::to_vec(&scene).expect("fixture serialization");
        bytes.as_ptr()
    })
}
#[no_mangle]
pub extern "C" fn frame_length() -> usize {
    FRAME.with(|frame| frame.borrow().len())
}
