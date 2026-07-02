use crossterm::event::{
    KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputAction {
    Quit,
    ToggleFocus,
    ToggleQuickMode,
    ToggleAutonomousMode,
    ToggleComputerUseMode,
    SubmitPrompt,
    CancelSelectedRun,
    DeleteSelectedRun,
    SelectPreviousRun,
    SelectNextRun,
    ScrollDetailsUp,
    ScrollDetailsDown,
    ClickAt { column: u16, row: u16 },
    BackspacePrompt,
    AppendPrompt(char),
    SpaceDictationPressed,
    SpaceDictationReleased,
}

#[cfg(test)]
pub fn map_key_event(key: KeyEvent) -> Option<InputAction> {
    map_key_event_with_keyboard_enhancement(key, false)
}

pub fn map_key_event_with_keyboard_enhancement(
    key: KeyEvent,
    enhanced_keyboard: bool,
) -> Option<InputAction> {
    if enhanced_keyboard && key.code == KeyCode::Char(' ') && key.modifiers == KeyModifiers::NONE {
        return match key.kind {
            KeyEventKind::Press => Some(InputAction::SpaceDictationPressed),
            KeyEventKind::Release => Some(InputAction::SpaceDictationReleased),
            KeyEventKind::Repeat => None,
        };
    }

    if key.kind != KeyEventKind::Press {
        return None;
    }

    match key.code {
        KeyCode::Esc => Some(InputAction::Quit),
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::Quit)
        }
        KeyCode::Char('x') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::CancelSelectedRun)
        }
        KeyCode::Char('d') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::DeleteSelectedRun)
        }
        KeyCode::Char('q') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::ToggleQuickMode)
        }
        KeyCode::Char('a') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::ToggleAutonomousMode)
        }
        KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::ToggleComputerUseMode)
        }
        KeyCode::Tab => Some(InputAction::ToggleFocus),
        KeyCode::PageUp => Some(InputAction::ScrollDetailsUp),
        KeyCode::PageDown => Some(InputAction::ScrollDetailsDown),
        KeyCode::Enter => Some(InputAction::SubmitPrompt),
        KeyCode::Backspace => Some(InputAction::BackspacePrompt),
        KeyCode::Up => Some(InputAction::SelectPreviousRun),
        KeyCode::Down => Some(InputAction::SelectNextRun),
        KeyCode::Char(value) => Some(InputAction::AppendPrompt(value)),
        _ => None,
    }
}

pub fn map_mouse_event(event: MouseEvent) -> Option<InputAction> {
    match event.kind {
        MouseEventKind::ScrollUp => Some(InputAction::SelectPreviousRun),
        MouseEventKind::ScrollDown => Some(InputAction::SelectNextRun),
        MouseEventKind::Down(MouseButton::Left) => Some(InputAction::ClickAt {
            column: event.column,
            row: event.row,
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use crossterm::event::{
        KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
    };

    use super::{
        map_key_event, map_key_event_with_keyboard_enhancement, map_mouse_event, InputAction,
    };

    fn press(code: KeyCode, modifiers: KeyModifiers) -> KeyEvent {
        KeyEvent::new(code, modifiers)
    }

    #[test]
    fn maps_quit_keys() {
        assert_eq!(
            map_key_event(press(KeyCode::Char('c'), KeyModifiers::CONTROL)),
            Some(InputAction::Quit)
        );
        assert_eq!(
            map_key_event(press(KeyCode::Esc, KeyModifiers::NONE)),
            Some(InputAction::Quit)
        );
    }

    #[test]
    fn maps_submit_key() {
        assert_eq!(
            map_key_event(press(KeyCode::Enter, KeyModifiers::NONE)),
            Some(InputAction::SubmitPrompt)
        );
    }

    #[test]
    fn maps_prompt_editing_keys() {
        assert_eq!(
            map_key_event(press(KeyCode::Backspace, KeyModifiers::NONE)),
            Some(InputAction::BackspacePrompt)
        );
        assert_eq!(
            map_key_event(press(KeyCode::Char('x'), KeyModifiers::NONE)),
            Some(InputAction::AppendPrompt('x'))
        );
    }

    #[test]
    fn maps_cancel_key() {
        assert_eq!(
            map_key_event(press(KeyCode::Char('x'), KeyModifiers::CONTROL)),
            Some(InputAction::CancelSelectedRun)
        );
    }

    #[test]
    fn maps_delete_key() {
        assert_eq!(
            map_key_event(press(KeyCode::Char('d'), KeyModifiers::CONTROL)),
            Some(InputAction::DeleteSelectedRun)
        );
    }

    #[test]
    fn maps_mode_toggle_keys() {
        assert_eq!(
            map_key_event(press(KeyCode::Char('q'), KeyModifiers::CONTROL)),
            Some(InputAction::ToggleQuickMode)
        );
        assert_eq!(
            map_key_event(press(KeyCode::Char('a'), KeyModifiers::CONTROL)),
            Some(InputAction::ToggleAutonomousMode)
        );
        assert_eq!(
            map_key_event(press(KeyCode::Char('u'), KeyModifiers::CONTROL)),
            Some(InputAction::ToggleComputerUseMode)
        );
    }

    #[test]
    fn maps_focus_and_scroll_keys() {
        assert_eq!(
            map_key_event(press(KeyCode::Tab, KeyModifiers::NONE)),
            Some(InputAction::ToggleFocus)
        );
        assert_eq!(
            map_key_event(press(KeyCode::PageUp, KeyModifiers::NONE)),
            Some(InputAction::ScrollDetailsUp)
        );
        assert_eq!(
            map_key_event(press(KeyCode::PageDown, KeyModifiers::NONE)),
            Some(InputAction::ScrollDetailsDown)
        );
    }

    #[test]
    fn maps_selection_keys() {
        assert_eq!(
            map_key_event(press(KeyCode::Up, KeyModifiers::NONE)),
            Some(InputAction::SelectPreviousRun)
        );
        assert_eq!(
            map_key_event(press(KeyCode::Down, KeyModifiers::NONE)),
            Some(InputAction::SelectNextRun)
        );
    }

    #[test]
    fn command_letters_without_control_edit_prompt() {
        assert_eq!(
            map_key_event(press(KeyCode::Char('q'), KeyModifiers::NONE)),
            Some(InputAction::AppendPrompt('q'))
        );
        assert_eq!(
            map_key_event(press(KeyCode::Char('c'), KeyModifiers::NONE)),
            Some(InputAction::AppendPrompt('c'))
        );
    }

    #[test]
    fn ignores_key_releases() {
        let event = KeyEvent {
            code: KeyCode::Char('n'),
            modifiers: KeyModifiers::NONE,
            kind: KeyEventKind::Release,
            state: crossterm::event::KeyEventState::empty(),
        };

        assert_eq!(map_key_event(event), None);
    }

    #[test]
    fn maps_space_hold_only_with_enhanced_keyboard() {
        let release = KeyEvent {
            code: KeyCode::Char(' '),
            modifiers: KeyModifiers::NONE,
            kind: KeyEventKind::Release,
            state: crossterm::event::KeyEventState::empty(),
        };
        let repeat = KeyEvent {
            code: KeyCode::Char(' '),
            modifiers: KeyModifiers::NONE,
            kind: KeyEventKind::Repeat,
            state: crossterm::event::KeyEventState::empty(),
        };

        assert_eq!(
            map_key_event(press(KeyCode::Char(' '), KeyModifiers::NONE)),
            Some(InputAction::AppendPrompt(' '))
        );
        assert_eq!(
            map_key_event_with_keyboard_enhancement(
                press(KeyCode::Char(' '), KeyModifiers::NONE),
                true,
            ),
            Some(InputAction::SpaceDictationPressed)
        );
        assert_eq!(
            map_key_event_with_keyboard_enhancement(release, true),
            Some(InputAction::SpaceDictationReleased)
        );
        assert_eq!(map_key_event_with_keyboard_enhancement(repeat, true), None);
        assert_eq!(
            map_key_event(press(KeyCode::F(1), KeyModifiers::NONE)),
            None
        );
    }

    #[test]
    fn maps_mouse_selection_events() {
        assert_eq!(
            map_mouse_event(MouseEvent {
                kind: MouseEventKind::ScrollUp,
                column: 0,
                row: 0,
                modifiers: KeyModifiers::NONE,
            }),
            Some(InputAction::SelectPreviousRun)
        );
        assert_eq!(
            map_mouse_event(MouseEvent {
                kind: MouseEventKind::ScrollDown,
                column: 0,
                row: 0,
                modifiers: KeyModifiers::NONE,
            }),
            Some(InputAction::SelectNextRun)
        );
        assert_eq!(
            map_mouse_event(MouseEvent {
                kind: MouseEventKind::Down(MouseButton::Left),
                column: 4,
                row: 8,
                modifiers: KeyModifiers::NONE,
            }),
            Some(InputAction::ClickAt { column: 4, row: 8 })
        );
        assert_eq!(
            map_mouse_event(MouseEvent {
                kind: MouseEventKind::Down(MouseButton::Right),
                column: 4,
                row: 8,
                modifiers: KeyModifiers::NONE,
            }),
            None
        );
    }
}
