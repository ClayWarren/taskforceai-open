use tokio::io::{AsyncRead, AsyncReadExt};

pub(crate) async fn read_limited_output<R>(
    mut reader: R,
    limit: usize,
    read_error: &str,
) -> Result<String, String>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut buffer = [0_u8; 4096];
    let mut truncated = false;

    loop {
        let read = reader
            .read(&mut buffer)
            .await
            .map_err(|error| format!("{read_error}: {error}"))?;
        if read == 0 {
            break;
        }

        let remaining = limit.saturating_sub(output.len());
        if remaining > 0 {
            let keep = remaining.min(read);
            output.extend_from_slice(&buffer[..keep]);
            truncated |= keep < read;
        } else {
            truncated = true;
        }
    }

    let mut text = String::from_utf8_lossy(&output).to_string();
    if truncated {
        text.push_str("\n...[output truncated]");
    }
    Ok(text)
}
