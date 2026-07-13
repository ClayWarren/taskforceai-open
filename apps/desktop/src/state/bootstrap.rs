use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Clone, Default)]
pub struct BootstrapState {
    ready: Arc<AtomicBool>,
    displayed: Arc<AtomicBool>,
}

impl BootstrapState {
    pub fn new() -> Self {
        Self {
            ready: Arc::new(AtomicBool::new(false)),
            displayed: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn mark_ready(&self) {
        self.ready.store(true, Ordering::Relaxed);
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::Relaxed)
    }

    pub fn mark_displayed(&self) -> bool {
        self.displayed
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub fn reset_displayed(&self) {
        self.displayed.store(false, Ordering::Release);
    }

    pub fn has_displayed(&self) -> bool {
        self.displayed.load(Ordering::Acquire)
    }
}

#[cfg(test)]
#[path = "bootstrap_tests.rs"]
mod tests;
