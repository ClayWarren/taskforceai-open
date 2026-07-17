use std::io::BufWriter;

use arboard::Clipboard;
use tempfile::NamedTempFile;

pub(crate) enum ClipboardContent {
    Image(NamedTempFile),
    Text(String),
}

// coverage:ignore-start -- reads the live host clipboard.
pub(crate) fn read() -> Result<ClipboardContent, String> {
    let mut clipboard = Clipboard::new().map_err(|error| format!("open clipboard: {error}"))?;
    if let Ok(image) = clipboard.get_image() {
        return encode_png(image.width, image.height, image.bytes.as_ref())
            .map(ClipboardContent::Image);
    }
    clipboard
        .get_text()
        .map(ClipboardContent::Text)
        .map_err(|error| format!("clipboard contains neither a supported image nor text: {error}"))
}

pub(crate) fn write_text(value: &str) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|error| format!("open clipboard: {error}"))?;
    clipboard
        .set_text(value.to_string())
        .map_err(|error| format!("write clipboard text: {error}"))
}
// coverage:ignore-end

fn encode_png(width: usize, height: usize, rgba: &[u8]) -> Result<NamedTempFile, String> {
    let width = u32::try_from(width).map_err(|_| "clipboard image is too wide".to_string())?;
    let height = u32::try_from(height).map_err(|_| "clipboard image is too tall".to_string())?;
    let mut file = tempfile::Builder::new()
        .prefix("taskforceai-clipboard-")
        .suffix(".png")
        .tempfile()
        .map_err(|error| format!("create clipboard image: {error}"))?;
    {
        let mut encoder = png::Encoder::new(BufWriter::new(file.as_file_mut()), width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|error| format!("encode clipboard image header: {error}"))?;
        writer
            .write_image_data(rgba)
            .map_err(|error| format!("encode clipboard image: {error}"))?;
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_rgba_encodes_as_png() {
        let file = encode_png(1, 1, &[255, 0, 0, 255]).expect("png");
        let bytes = std::fs::read(file.path()).expect("read png");
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    }
}
