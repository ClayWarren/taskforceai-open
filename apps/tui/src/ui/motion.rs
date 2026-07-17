const SPINNER_FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PULSE_FRAMES: [&str; 4] = ["·", "•", "●", "•"];

pub(super) fn spinner(frame: u64) -> &'static str {
    SPINNER_FRAMES[frame as usize % SPINNER_FRAMES.len()]
}

pub(super) fn pulse(frame: u64) -> &'static str {
    PULSE_FRAMES[(frame as usize / 3) % PULSE_FRAMES.len()]
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::text::Line;

    #[test]
    fn motion_frames_are_stable_single_column_glyphs() {
        for frame in SPINNER_FRAMES.into_iter().chain(PULSE_FRAMES) {
            assert_eq!(
                Line::from(frame).width(),
                1,
                "{frame:?} must not shift surrounding text"
            );
        }
    }
}
