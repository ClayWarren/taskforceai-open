use super::*;

#[test]
fn parse_appshot_text_capture_keeps_app_window_and_text() {
    let capture = parse_appshot_text_capture("Safari\nAPI Reference\nvisible text\nmore text\n");

    assert_eq!(capture.app_name.as_deref(), Some("Safari"));
    assert_eq!(capture.window_title.as_deref(), Some("API Reference"));
    assert_eq!(capture.text.as_deref(), Some("visible text\nmore text"));
    assert!(!capture.accessibility_required);
}

#[test]
fn parse_appshot_text_capture_marks_accessibility_when_text_missing() {
    let capture = parse_appshot_text_capture("Mail\nInbox\n");

    assert_eq!(capture.app_name.as_deref(), Some("Mail"));
    assert_eq!(capture.window_title.as_deref(), Some("Inbox"));
    assert_eq!(capture.text, None);
    assert!(capture.accessibility_required);
}

#[test]
fn truncate_text_preserves_utf8_boundary() {
    let truncated = truncate_text("hello 🧪 world", 10);

    assert_eq!(truncated, "hello 🧪\n\n[Appshot text truncated]");
}
