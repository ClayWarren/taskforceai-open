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
