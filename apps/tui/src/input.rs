use crossterm::event::{
    KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputAction {
    Dismiss,
    CancelOrQuit,
    #[cfg(test)]
    Quit,
    ShowHelp,
    OpenExternalEditor,
    ToggleFocus,
    ToggleSidebar,
    ToggleQuickMode,
    ToggleAutonomousMode,
    ToggleComputerUseMode,
    ToggleRawOutput,
    ToggleToolDetails,
    CycleAgentThread,
    SubmitPrompt,
    CancelSelectedRun,
    DeleteSelectedRun,
    SelectPreviousRun,
    SelectNextRun,
    ScrollDetailsUp,
    ScrollDetailsDown,
    ScrollUpAt {
        column: u16,
        row: u16,
    },
    ScrollDownAt {
        column: u16,
        row: u16,
    },
    ClickAt {
        column: u16,
        row: u16,
    },
    BackspacePrompt,
    DeletePrompt,
    MovePromptLeft,
    MovePromptRight,
    MovePromptHome,
    MovePromptEnd,
    MovePromptWordLeft,
    MovePromptWordRight,
    DeletePromptWordBackward,
    DeletePromptWordForward,
    KillPromptLineStart,
    KillPromptLineEnd,
    YankPrompt,
    UndoPrompt,
    RedoPrompt,
    InsertPromptNewline,
    QueuePromptAfterResponse,
    PasteClipboard,
    PastePrompt(String),
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
        KeyCode::Esc => Some(InputAction::Dismiss),
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::CancelOrQuit)
        }
        KeyCode::F(1) => Some(InputAction::ShowHelp),
        KeyCode::Char('o') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::OpenExternalEditor)
        }
        KeyCode::Char('z')
            if key.modifiers.contains(KeyModifiers::CONTROL)
                && key.modifiers.contains(KeyModifiers::SHIFT) =>
        {
            Some(InputAction::RedoPrompt)
        }
        KeyCode::Char('Z') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::RedoPrompt)
        }
        KeyCode::Char('z') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::UndoPrompt)
        }
        KeyCode::Char('w') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::DeletePromptWordBackward)
        }
        KeyCode::Backspace
            if key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
        {
            Some(InputAction::DeletePromptWordBackward)
        }
        KeyCode::Delete
            if key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
        {
            Some(InputAction::DeletePromptWordForward)
        }
        KeyCode::Char('d') if key.modifiers.contains(KeyModifiers::ALT) => {
            Some(InputAction::DeletePromptWordForward)
        }
        KeyCode::Char('k') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::KillPromptLineEnd)
        }
        KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::ALT) => {
            Some(InputAction::KillPromptLineStart)
        }
        KeyCode::Char('y') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::YankPrompt)
        }
        KeyCode::Char('x') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::CancelSelectedRun)
        }
        KeyCode::Char('d') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::DeleteSelectedRun)
        }
        KeyCode::Char('b') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::ToggleSidebar)
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
        KeyCode::Char('r') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::ToggleRawOutput)
        }
        KeyCode::Char('e') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::ToggleToolDetails)
        }
        KeyCode::Char('g') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(InputAction::CycleAgentThread)
        }
        KeyCode::Char('v')
            if key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::SUPER) =>
        {
            Some(InputAction::PasteClipboard)
        }
        KeyCode::Tab => Some(InputAction::ToggleFocus),
        KeyCode::PageUp => Some(InputAction::ScrollDetailsUp),
        KeyCode::PageDown => Some(InputAction::ScrollDetailsDown),
        KeyCode::Enter if key.modifiers.contains(KeyModifiers::ALT) => {
            Some(InputAction::QueuePromptAfterResponse)
        }
        KeyCode::Enter if key.modifiers.contains(KeyModifiers::SHIFT) => {
            Some(InputAction::InsertPromptNewline)
        }
        KeyCode::Enter => Some(InputAction::SubmitPrompt),
        KeyCode::Backspace => Some(InputAction::BackspacePrompt),
        KeyCode::Delete => Some(InputAction::DeletePrompt),
        KeyCode::Home => Some(InputAction::MovePromptHome),
        KeyCode::End => Some(InputAction::MovePromptEnd),
        KeyCode::Up => Some(InputAction::SelectPreviousRun),
        KeyCode::Down => Some(InputAction::SelectNextRun),
        KeyCode::Left
            if key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
        {
            Some(InputAction::MovePromptWordLeft)
        }
        KeyCode::Right
            if key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
        {
            Some(InputAction::MovePromptWordRight)
        }
        KeyCode::Left => Some(InputAction::MovePromptLeft),
        KeyCode::Right => Some(InputAction::MovePromptRight),
        KeyCode::Char(value) => Some(InputAction::AppendPrompt(value)),
        _ => None,
    }
}

pub fn map_mouse_event(event: MouseEvent) -> Option<InputAction> {
    match event.kind {
        MouseEventKind::ScrollUp => Some(InputAction::ScrollUpAt {
            column: event.column,
            row: event.row,
        }),
        MouseEventKind::ScrollDown => Some(InputAction::ScrollDownAt {
            column: event.column,
            row: event.row,
        }),
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
    fn maps_contextual_cancel_keys() {
        assert_eq!(
            map_key_event(press(KeyCode::Char('c'), KeyModifiers::CONTROL)),
            Some(InputAction::CancelOrQuit)
        );
        assert_eq!(
            map_key_event(press(KeyCode::Esc, KeyModifiers::NONE)),
            Some(InputAction::Dismiss)
        );
    }

    #[test]
    fn maps_submit_key() {
        assert_eq!(
            map_key_event(press(KeyCode::Enter, KeyModifiers::NONE)),
            Some(InputAction::SubmitPrompt)
        );
        assert_eq!(
            map_key_event(press(KeyCode::Enter, KeyModifiers::SHIFT)),
            Some(InputAction::InsertPromptNewline)
        );
        assert_eq!(
            map_key_event(press(KeyCode::Enter, KeyModifiers::ALT)),
            Some(InputAction::QueuePromptAfterResponse)
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
        assert_eq!(
            map_key_event(press(KeyCode::Delete, KeyModifiers::NONE)),
            Some(InputAction::DeletePrompt)
        );
        assert_eq!(
            map_key_event(press(KeyCode::Home, KeyModifiers::NONE)),
            Some(InputAction::MovePromptHome)
        );
        assert_eq!(
            map_key_event(press(KeyCode::End, KeyModifiers::NONE)),
            Some(InputAction::MovePromptEnd)
        );

        for (code, modifiers, expected) in [
            (
                KeyCode::Char('o'),
                KeyModifiers::CONTROL,
                InputAction::OpenExternalEditor,
            ),
            (
                KeyCode::Char('z'),
                KeyModifiers::CONTROL | KeyModifiers::SHIFT,
                InputAction::RedoPrompt,
            ),
            (
                KeyCode::Char('Z'),
                KeyModifiers::CONTROL,
                InputAction::RedoPrompt,
            ),
            (
                KeyCode::Char('z'),
                KeyModifiers::CONTROL,
                InputAction::UndoPrompt,
            ),
            (
                KeyCode::Char('w'),
                KeyModifiers::CONTROL,
                InputAction::DeletePromptWordBackward,
            ),
            (
                KeyCode::Backspace,
                KeyModifiers::ALT,
                InputAction::DeletePromptWordBackward,
            ),
            (
                KeyCode::Delete,
                KeyModifiers::CONTROL,
                InputAction::DeletePromptWordForward,
            ),
            (
                KeyCode::Char('d'),
                KeyModifiers::ALT,
                InputAction::DeletePromptWordForward,
            ),
            (
                KeyCode::Char('k'),
                KeyModifiers::CONTROL,
                InputAction::KillPromptLineEnd,
            ),
            (
                KeyCode::Char('u'),
                KeyModifiers::ALT,
                InputAction::KillPromptLineStart,
            ),
            (
                KeyCode::Char('y'),
                KeyModifiers::CONTROL,
                InputAction::YankPrompt,
            ),
            (
                KeyCode::Left,
                KeyModifiers::CONTROL,
                InputAction::MovePromptWordLeft,
            ),
            (
                KeyCode::Right,
                KeyModifiers::ALT,
                InputAction::MovePromptWordRight,
            ),
        ] {
            assert_eq!(map_key_event(press(code, modifiers)), Some(expected));
        }
        assert_eq!(
            map_key_event(press(KeyCode::Null, KeyModifiers::NONE)),
            None
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
    fn maps_sidebar_toggle_key() {
        assert_eq!(
            map_key_event(press(KeyCode::Char('b'), KeyModifiers::CONTROL)),
            Some(InputAction::ToggleSidebar)
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
        assert_eq!(
            map_key_event(press(KeyCode::Char('r'), KeyModifiers::CONTROL)),
            Some(InputAction::ToggleRawOutput)
        );
        assert_eq!(
            map_key_event(press(KeyCode::Char('e'), KeyModifiers::CONTROL)),
            Some(InputAction::ToggleToolDetails)
        );
        assert_eq!(
            map_key_event(press(KeyCode::Char('g'), KeyModifiers::CONTROL)),
            Some(InputAction::CycleAgentThread)
        );
        assert_eq!(
            map_key_event(press(KeyCode::Char('v'), KeyModifiers::CONTROL)),
            Some(InputAction::PasteClipboard)
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
        assert_eq!(
            map_key_event(press(KeyCode::Left, KeyModifiers::NONE)),
            Some(InputAction::MovePromptLeft)
        );
        assert_eq!(
            map_key_event(press(KeyCode::Right, KeyModifiers::NONE)),
            Some(InputAction::MovePromptRight)
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
            Some(InputAction::ShowHelp)
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
            Some(InputAction::ScrollUpAt { column: 0, row: 0 })
        );
        assert_eq!(
            map_mouse_event(MouseEvent {
                kind: MouseEventKind::ScrollDown,
                column: 0,
                row: 0,
                modifiers: KeyModifiers::NONE,
            }),
            Some(InputAction::ScrollDownAt { column: 0, row: 0 })
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
