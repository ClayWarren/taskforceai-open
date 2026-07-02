use super::*;
use std::pin::Pin;
use std::sync::OnceLock;
use std::task::{Context, Poll};
use tokio::io::ReadBuf;
use tokio::sync::Mutex;

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[tokio::test]
async fn coverage_voice_commands_execute() {
    let _guard = env_lock().lock().await;
    voice_init().await.expect("init");
    std::env::set_var(LISTEN_COMMAND_ENV, "printf 'desktop voice\\n'");
    assert_eq!(voice_listen().await.expect("listen"), "desktop voice");
    std::env::remove_var(LISTEN_COMMAND_ENV);
    voice_speak("coverage check".into()).await.expect("speak");
    voice_cancel().await.expect("cancel");
}

#[tokio::test]
async fn voice_listen_requires_configured_command() {
    let _guard = env_lock().lock().await;
    std::env::remove_var(LISTEN_COMMAND_ENV);

    let err = voice_listen().await.expect_err("missing command");

    assert!(err.contains(LISTEN_COMMAND_ENV));
}

#[tokio::test]
async fn voice_listen_reports_stderr_for_failed_command() {
    let _guard = env_lock().lock().await;
    std::env::set_var(
        LISTEN_COMMAND_ENV,
        "printf 'bad stdout'; printf 'bad stderr' >&2; exit 7",
    );

    let err = voice_listen().await.expect_err("failed command");

    assert_eq!(err, "bad stderr");
    std::env::remove_var(LISTEN_COMMAND_ENV);
}

#[tokio::test]
async fn voice_listen_reports_stdout_when_stderr_is_empty() {
    let _guard = env_lock().lock().await;
    std::env::set_var(LISTEN_COMMAND_ENV, "printf 'bad stdout'; exit 7");

    let err = voice_listen().await.expect_err("failed command");

    assert_eq!(err, "bad stdout");
    std::env::remove_var(LISTEN_COMMAND_ENV);
}

#[tokio::test]
async fn voice_listen_reports_status_when_failed_command_is_silent() {
    let _guard = env_lock().lock().await;
    std::env::set_var(LISTEN_COMMAND_ENV, "exit 7");

    let err = voice_listen().await.expect_err("failed command");

    assert!(err.contains("Voice listen command exited with"));
    std::env::remove_var(LISTEN_COMMAND_ENV);
}

#[tokio::test]
async fn voice_listen_rejects_empty_transcript() {
    let _guard = env_lock().lock().await;
    std::env::set_var(LISTEN_COMMAND_ENV, "true");

    let err = voice_listen().await.expect_err("empty transcript");

    assert_eq!(err, "Voice listen command produced no transcript");
    std::env::remove_var(LISTEN_COMMAND_ENV);
}

#[tokio::test]
async fn voice_listen_output_is_capped() {
    let input = tokio_test::io::Builder::new()
        .read(b"abcdef")
        .read(b"ghijkl")
        .build();

    let output = read_limited_output(input, 8).await.expect("read output");

    assert_eq!(output, "abcdefgh\n...[output truncated]");
}

#[tokio::test]
async fn voice_listen_output_reports_truncation_after_limit_is_full() {
    let input = tokio_test::io::Builder::new()
        .read(b"abcd")
        .read(b"ef")
        .build();

    let output = read_limited_output(input, 4).await.expect("read output");

    assert_eq!(output, "abcd\n...[output truncated]");
}

struct FailingReader;

impl AsyncRead for FailingReader {
    fn poll_read(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        _buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Poll::Ready(Err(std::io::Error::other("read failed")))
    }
}

#[tokio::test]
async fn voice_listen_output_reports_read_errors() {
    let err = read_limited_output(FailingReader, 8)
        .await
        .expect_err("read should fail");

    assert!(err.contains("Voice listen output read failed"));
}
