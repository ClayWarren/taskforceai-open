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
mod tests {
    use super::*;

    #[test]
    fn bootstrap_state_transitions() {
        let state = BootstrapState::new();
        assert!(!state.is_ready());
        assert!(!state.has_displayed());

        state.mark_ready();
        assert!(state.is_ready());

        assert!(state.mark_displayed());
        assert!(state.has_displayed());
        assert!(!state.mark_displayed());
    }

    #[test]
    fn bootstrap_display_claim_can_be_reset_after_failure() {
        let state = BootstrapState::new();
        assert!(state.mark_displayed());
        assert!(state.has_displayed());

        state.reset_displayed();
        assert!(!state.has_displayed());
        assert!(state.mark_displayed());
    }
}
