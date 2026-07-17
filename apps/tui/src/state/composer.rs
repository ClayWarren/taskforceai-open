use super::{AppState, ComposerSnapshot, FocusArea, PastedBlock};

const LARGE_PASTE_MIN_LINES: usize = 8;
const LARGE_PASTE_MIN_BYTES: usize = 1_000;

impl AppState {
    pub(super) fn append_prompt(&mut self, value: char) {
        if value.is_control() {
            return;
        }
        self.normalize_prompt_cursor();
        self.push_prompt_undo();
        self.prompt_input.insert(self.prompt_cursor, value);
        self.prompt_cursor += value.len_utf8();
        self.after_prompt_edit();
    }

    pub fn paste_prompt(&mut self, value: &str) {
        let value = value.replace("\r\n", "\n").replace('\r', "\n");
        if value.is_empty() {
            return;
        }
        self.push_prompt_undo();
        let line_count = value.lines().count().max(1);
        if line_count >= LARGE_PASTE_MIN_LINES || value.len() >= LARGE_PASTE_MIN_BYTES {
            self.paste_large_block(value, line_count);
            return;
        }
        self.normalize_prompt_cursor();
        self.prompt_input.insert_str(self.prompt_cursor, &value);
        self.prompt_cursor += value.len();
        self.after_prompt_edit();
    }

    fn paste_large_block(&mut self, content: String, line_count: usize) {
        self.normalize_prompt_cursor();
        let number = self.pasted_blocks.len() + 1;
        let marker = format!("[Pasted text #{number} · {line_count} lines]");
        self.prompt_input.insert_str(self.prompt_cursor, &marker);
        self.prompt_cursor += marker.len();
        self.pasted_blocks.push(PastedBlock { marker, content });
        self.after_prompt_edit();
        self.status_line = format!("Folded pasted text ({line_count} lines)");
    }

    pub fn expanded_prompt(&self) -> String {
        self.pasted_blocks
            .iter()
            .fold(self.prompt_input.clone(), |prompt, block| {
                prompt.replace(&block.marker, &block.content)
            })
    }

    pub fn insert_prompt_newline(&mut self) {
        self.normalize_prompt_cursor();
        self.push_prompt_undo();
        self.prompt_input.insert(self.prompt_cursor, '\n');
        self.prompt_cursor += 1;
        self.after_prompt_edit();
    }

    pub fn backspace_prompt(&mut self) {
        self.normalize_prompt_cursor();
        let Some(previous) = previous_boundary(&self.prompt_input, self.prompt_cursor) else {
            return;
        };
        self.push_prompt_undo();
        self.prompt_input.drain(previous..self.prompt_cursor);
        self.prompt_cursor = previous;
        self.after_prompt_edit();
    }

    pub fn delete_prompt(&mut self) {
        self.normalize_prompt_cursor();
        let Some(next) = next_boundary(&self.prompt_input, self.prompt_cursor) else {
            return;
        };
        self.push_prompt_undo();
        self.prompt_input.drain(self.prompt_cursor..next);
        self.after_prompt_edit();
    }

    pub fn move_prompt_left(&mut self) {
        self.normalize_prompt_cursor();
        if let Some(previous) = previous_boundary(&self.prompt_input, self.prompt_cursor) {
            self.prompt_cursor = previous;
        }
    }

    pub fn move_prompt_right(&mut self) {
        self.normalize_prompt_cursor();
        if let Some(next) = next_boundary(&self.prompt_input, self.prompt_cursor) {
            self.prompt_cursor = next;
        }
    }

    pub fn move_prompt_word_left(&mut self) {
        self.normalize_prompt_cursor();
        self.prompt_cursor = previous_word_boundary(&self.prompt_input, self.prompt_cursor);
    }

    pub fn move_prompt_word_right(&mut self) {
        self.normalize_prompt_cursor();
        self.prompt_cursor = next_word_boundary(&self.prompt_input, self.prompt_cursor);
    }

    pub fn delete_prompt_word_backward(&mut self) {
        self.normalize_prompt_cursor();
        let start = previous_word_boundary(&self.prompt_input, self.prompt_cursor);
        if start == self.prompt_cursor {
            return;
        }
        self.push_prompt_undo();
        self.prompt_input.drain(start..self.prompt_cursor);
        self.prompt_cursor = start;
        self.after_prompt_edit();
    }

    pub fn delete_prompt_word_forward(&mut self) {
        self.normalize_prompt_cursor();
        let end = next_word_boundary(&self.prompt_input, self.prompt_cursor);
        if end == self.prompt_cursor {
            return;
        }
        self.push_prompt_undo();
        self.prompt_input.drain(self.prompt_cursor..end);
        self.after_prompt_edit();
    }

    pub fn kill_prompt_line_start(&mut self) {
        self.normalize_prompt_cursor();
        let start = self.prompt_input[..self.prompt_cursor]
            .rfind('\n')
            .map_or(0, |index| index + 1);
        if start == self.prompt_cursor {
            return;
        }
        self.push_prompt_undo();
        self.prompt_kill_buffer = self.prompt_input[start..self.prompt_cursor].to_string();
        self.prompt_input.drain(start..self.prompt_cursor);
        self.prompt_cursor = start;
        self.after_prompt_edit();
    }

    pub fn kill_prompt_line_end(&mut self) {
        self.normalize_prompt_cursor();
        let end = self.prompt_input[self.prompt_cursor..]
            .find('\n')
            .map_or(self.prompt_input.len(), |index| self.prompt_cursor + index);
        if end == self.prompt_cursor {
            return;
        }
        self.push_prompt_undo();
        self.prompt_kill_buffer = self.prompt_input[self.prompt_cursor..end].to_string();
        self.prompt_input.drain(self.prompt_cursor..end);
        self.after_prompt_edit();
    }

    pub fn yank_prompt(&mut self) {
        if self.prompt_kill_buffer.is_empty() {
            return;
        }
        self.normalize_prompt_cursor();
        self.push_prompt_undo();
        let value = self.prompt_kill_buffer.clone();
        self.prompt_input.insert_str(self.prompt_cursor, &value);
        self.prompt_cursor += value.len();
        self.after_prompt_edit();
    }

    pub fn undo_prompt(&mut self) {
        let Some(snapshot) = self.prompt_undo_stack.pop() else {
            self.status_line = "Nothing to undo in the prompt".to_string();
            return;
        };
        self.prompt_redo_stack.push(self.prompt_snapshot());
        self.restore_prompt_snapshot(snapshot);
        self.status_line = "Prompt edit undone".to_string();
    }

    pub fn redo_prompt(&mut self) {
        let Some(snapshot) = self.prompt_redo_stack.pop() else {
            self.status_line = "Nothing to redo in the prompt".to_string();
            return;
        };
        self.prompt_undo_stack.push(self.prompt_snapshot());
        self.restore_prompt_snapshot(snapshot);
        self.status_line = "Prompt edit redone".to_string();
    }

    pub fn move_prompt_home(&mut self) {
        self.normalize_prompt_cursor();
        self.prompt_cursor = self.prompt_input[..self.prompt_cursor]
            .rfind('\n')
            .map_or(0, |index| index + 1);
    }

    pub fn move_prompt_end(&mut self) {
        self.normalize_prompt_cursor();
        self.prompt_cursor = self.prompt_input[self.prompt_cursor..]
            .find('\n')
            .map_or(self.prompt_input.len(), |index| self.prompt_cursor + index);
    }

    pub fn record_prompt_history(&mut self, prompt: &str) {
        let prompt = prompt.trim();
        if prompt.is_empty() {
            return;
        }
        if self.prompt_history.last().is_none_or(|last| last != prompt) {
            self.prompt_history.push(prompt.to_string());
            if self.prompt_history.len() > super::MAX_PROMPT_HISTORY {
                self.prompt_history.remove(0);
            }
        }
        self.prompt_history_index = None;
        self.prompt_history_draft.clear();
    }

    pub fn previous_prompt_history(&mut self) {
        if self.prompt_history.is_empty() {
            return;
        }
        let next = match self.prompt_history_index {
            Some(index) => index.saturating_sub(1),
            None => {
                self.prompt_history_draft = self.expanded_prompt();
                self.prompt_history.len().saturating_sub(1)
            }
        };
        let value = self.prompt_history[next].clone();
        self.restore_prompt_text(value);
        self.prompt_history_index = Some(next);
    }

    pub fn next_prompt_history(&mut self) {
        let Some(index) = self.prompt_history_index else {
            return;
        };
        if index + 1 < self.prompt_history.len() {
            let next = index + 1;
            let value = self.prompt_history[next].clone();
            self.restore_prompt_text(value);
            self.prompt_history_index = Some(next);
        } else {
            let draft = std::mem::take(&mut self.prompt_history_draft);
            self.restore_prompt_text(draft);
            self.prompt_history_index = None;
        }
    }

    pub fn mention_query(&self) -> Option<&str> {
        let cursor = self.prompt_cursor.min(self.prompt_input.len());
        let token = self.prompt_input[..cursor]
            .rsplit_once(char::is_whitespace)
            .map_or(&self.prompt_input[..cursor], |(_, token)| token);
        token.strip_prefix('@')
    }

    pub fn set_file_suggestions(&mut self, files: Vec<String>) {
        self.file_suggestions = files;
        self.selected_file_suggestion = (!self.file_suggestions.is_empty()).then_some(0);
    }

    pub fn file_suggestions_active(&self) -> bool {
        self.focus == FocusArea::Prompt
            && !self.suggestions_suppressed
            && !self.file_suggestions.is_empty()
    }

    pub fn select_file_suggestion(&mut self, delta: isize) {
        if self.file_suggestions.is_empty() {
            self.selected_file_suggestion = None;
            return;
        }
        let current = self.selected_file_suggestion.unwrap_or(0);
        let last = self.file_suggestions.len().saturating_sub(1) as isize;
        self.selected_file_suggestion = Some((current as isize + delta).clamp(0, last) as usize);
    }

    pub fn accept_file_suggestion(&mut self) -> bool {
        let Some(path) = self
            .selected_file_suggestion
            .and_then(|index| self.file_suggestions.get(index))
            .cloned()
        else {
            return false;
        };
        self.normalize_prompt_cursor();
        let token_start = self.prompt_input[..self.prompt_cursor]
            .rfind(char::is_whitespace)
            .map_or(0, |index| index + 1);
        let mention = crate::local_coding::format_workspace_mention(&path);
        self.prompt_input
            .replace_range(token_start..self.prompt_cursor, &format!("{mention} "));
        self.prompt_cursor = token_start + mention.len() + 1;
        self.file_suggestions.clear();
        self.selected_file_suggestion = None;
        self.refresh_command_suggestions();
        true
    }

    pub fn clear_prompt(&mut self) {
        self.prompt_input.clear();
        self.prompt_cursor = 0;
        self.pasted_blocks.clear();
        self.file_suggestions.clear();
        self.selected_file_suggestion = None;
        self.suggestions_suppressed = false;
        self.refresh_command_suggestions();
    }

    pub fn dismiss_prompt_suggestions(&mut self) -> bool {
        if !self.command_suggestions_active() && !self.file_suggestions_active() {
            return false;
        }
        self.suggestions_suppressed = true;
        self.status_line = "Suggestions dismissed".to_string();
        true
    }

    pub fn replace_prompt_from_editor(&mut self, value: String) {
        if self.expanded_prompt() == value {
            return;
        }
        self.push_prompt_undo();
        self.set_prompt_text(value);
        self.status_line = "Prompt updated from external editor".to_string();
    }

    fn after_prompt_edit(&mut self) {
        self.prompt_history_index = None;
        self.suggestions_suppressed = false;
        self.refresh_command_suggestions();
        if self.mention_query().is_none() {
            self.file_suggestions.clear();
            self.selected_file_suggestion = None;
        }
    }

    fn restore_prompt_text(&mut self, value: String) {
        self.set_prompt_text(value);
    }

    fn set_prompt_text(&mut self, value: String) {
        self.prompt_input.clear();
        self.prompt_cursor = 0;
        self.pasted_blocks.clear();
        self.file_suggestions.clear();
        self.selected_file_suggestion = None;
        let line_count = value.lines().count().max(1);
        if line_count >= LARGE_PASTE_MIN_LINES || value.len() >= LARGE_PASTE_MIN_BYTES {
            self.paste_large_block(value, line_count);
        } else {
            self.prompt_input = value;
            self.prompt_cursor = self.prompt_input.len();
            self.after_prompt_edit();
        }
    }

    fn prompt_snapshot(&self) -> ComposerSnapshot {
        ComposerSnapshot {
            input: self.prompt_input.clone(),
            cursor: self.prompt_cursor,
            pasted_blocks: self.pasted_blocks.clone(),
        }
    }

    fn push_prompt_undo(&mut self) {
        self.prompt_undo_stack.push(self.prompt_snapshot());
        if self.prompt_undo_stack.len() > 100 {
            self.prompt_undo_stack.remove(0);
        }
        self.prompt_redo_stack.clear();
    }

    fn restore_prompt_snapshot(&mut self, snapshot: ComposerSnapshot) {
        self.prompt_input = snapshot.input;
        self.prompt_cursor = snapshot.cursor;
        self.pasted_blocks = snapshot.pasted_blocks;
        self.normalize_prompt_cursor();
        self.after_prompt_edit();
    }

    fn normalize_prompt_cursor(&mut self) {
        self.prompt_cursor = self.prompt_cursor.min(self.prompt_input.len());
        while !self.prompt_input.is_char_boundary(self.prompt_cursor) {
            self.prompt_cursor = self.prompt_cursor.saturating_sub(1);
        }
    }
}

fn previous_boundary(value: &str, cursor: usize) -> Option<usize> {
    value[..cursor]
        .char_indices()
        .next_back()
        .map(|(index, _)| index)
}

fn next_boundary(value: &str, cursor: usize) -> Option<usize> {
    let character = value[cursor..].chars().next()?;
    Some(cursor + character.len_utf8())
}

fn previous_word_boundary(value: &str, cursor: usize) -> usize {
    let mut index = cursor.min(value.len());
    while let Some((previous, character)) = previous_character(value, index) {
        if !character.is_whitespace() {
            break;
        }
        index = previous;
    }
    let Some((_, character)) = previous_character(value, index) else {
        return index;
    };
    let word = is_word_character(character);
    while let Some((previous, character)) = previous_character(value, index) {
        if character.is_whitespace() || is_word_character(character) != word {
            break;
        }
        index = previous;
    }
    index
}

fn next_word_boundary(value: &str, cursor: usize) -> usize {
    let mut index = cursor.min(value.len());
    let Some(character) = value[index..].chars().next() else {
        return index;
    };
    let word = is_word_character(character);
    while let Some(character) = value[index..].chars().next() {
        if character.is_whitespace() || is_word_character(character) != word {
            break;
        }
        index += character.len_utf8();
    }
    while let Some(character) = value[index..].chars().next() {
        if !character.is_whitespace() {
            break;
        }
        index += character.len_utf8();
    }
    index
}

fn previous_character(value: &str, cursor: usize) -> Option<(usize, char)> {
    value[..cursor].char_indices().next_back()
}

fn is_word_character(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::initialized_default_capabilities;

    fn state() -> AppState {
        AppState::new(initialized_default_capabilities(), Vec::new())
    }

    #[test]
    fn cursor_editing_handles_unicode_and_multiline_text() {
        let mut state = state();
        state.paste_prompt("héllo\nworld");
        state.move_prompt_home();
        state.append_prompt('>');
        state.move_prompt_end();
        state.backspace_prompt();
        state.delete_prompt();
        assert_eq!(state.prompt_input, "héllo\n>worl");
        assert!(state.prompt_input.is_char_boundary(state.prompt_cursor));
    }

    #[test]
    fn history_preserves_draft_and_avoids_duplicate_entries() {
        let mut state = state();
        state.record_prompt_history("first");
        state.record_prompt_history("second");
        state.record_prompt_history("second");
        state.paste_prompt("draft");
        state.previous_prompt_history();
        assert_eq!(state.prompt_input, "second");
        state.previous_prompt_history();
        assert_eq!(state.prompt_input, "first");
        state.next_prompt_history();
        state.next_prompt_history();
        assert_eq!(state.prompt_input, "draft");
        assert_eq!(state.prompt_history.len(), 2);
    }

    #[test]
    fn large_pastes_fold_for_editing_and_expand_for_submission() {
        let mut state = state();
        let pasted = (1..=10)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");

        state.paste_prompt(&pasted);

        assert_eq!(state.pasted_blocks.len(), 1);
        assert!(state.prompt_input.contains("[Pasted text #1 · 10 lines]"));
        assert_eq!(state.expanded_prompt(), pasted);
        state.clear_prompt();
        assert!(state.pasted_blocks.is_empty());
    }

    #[test]
    fn file_suggestion_replaces_only_active_mention() {
        let mut state = state();
        state.paste_prompt("review @app");
        state.set_file_suggestions(vec!["apps/tui/src/app.rs".to_string()]);
        assert!(state.accept_file_suggestion());
        assert_eq!(state.prompt_input, "review @apps/tui/src/app.rs ");
        assert!(state.file_suggestions.is_empty());

        state.clear_prompt();
        state.paste_prompt("review @road");
        state.set_file_suggestions(vec!["docs/road map}.md".to_string()]);
        assert!(state.accept_file_suggestion());
        assert_eq!(state.prompt_input, "review @{docs/road map\\}.md} ");
    }

    #[test]
    fn composer_edges_cover_history_cursor_mentions_and_suggestions() {
        let mut populated = state();
        populated.append_prompt('\n');
        assert!(populated.prompt_input.is_empty());
        populated.paste_prompt("a\r\nb\rc");
        assert_eq!(populated.prompt_input, "a\nb\nc");
        populated.prompt_cursor = 2;
        populated.insert_prompt_newline();
        populated.move_prompt_home();
        populated.move_prompt_left();
        populated.move_prompt_end();
        populated.move_prompt_right();
        populated.prompt_input = "abc".into();
        populated.prompt_cursor = 1;
        populated.delete_prompt();
        assert_eq!(populated.prompt_input, "ac");
        populated.clear_prompt();
        populated.backspace_prompt();
        populated.delete_prompt();

        populated.record_prompt_history("  ");
        for index in 0..=200 {
            populated.record_prompt_history(&format!("prompt-{index}"));
        }
        assert_eq!(populated.prompt_history.len(), 200);
        populated.clear_prompt();
        populated.previous_prompt_history();
        populated.previous_prompt_history();
        populated.next_prompt_history();
        assert!(populated.prompt_history_index.is_some());

        let mut empty_history = state();
        empty_history.previous_prompt_history();
        empty_history.next_prompt_history();
        assert_eq!(empty_history.mention_query(), None);
        empty_history.paste_prompt("ask @src");
        assert_eq!(empty_history.mention_query(), Some("src"));
        empty_history.set_file_suggestions(Vec::new());
        empty_history.select_file_suggestion(1);
        assert!(!empty_history.accept_file_suggestion());
        empty_history.set_file_suggestions(vec!["one".into(), "two".into()]);
        empty_history.select_file_suggestion(99);
        assert_eq!(empty_history.selected_file_suggestion, Some(1));
        empty_history.select_file_suggestion(-99);
        assert_eq!(empty_history.selected_file_suggestion, Some(0));
        empty_history.append_prompt(' ');
        assert!(empty_history.file_suggestions.is_empty());

        empty_history.prompt_input = "é".into();
        empty_history.prompt_cursor = 1;
        empty_history.append_prompt('x');
        assert!(empty_history
            .prompt_input
            .is_char_boundary(empty_history.prompt_cursor));
    }

    #[test]
    fn advanced_composer_edits_cover_words_kill_ring_undo_and_editor() {
        let mut state = state();
        state.paste_prompt("");
        state.undo_prompt();
        state.redo_prompt();
        assert!(state.status_line.contains("Nothing"));

        state.paste_prompt("alpha_beta  +punct\nlast");
        state.move_prompt_word_left();
        assert_eq!(state.prompt_cursor, 19);
        state.move_prompt_word_left();
        state.move_prompt_word_right();
        state.delete_prompt_word_backward();
        state.delete_prompt_word_forward();

        state.clear_prompt();
        state.paste_prompt("first\nsecond");
        state.prompt_cursor = "first\nsec".len();
        state.kill_prompt_line_start();
        assert_eq!(state.prompt_input, "first\nond");
        state.yank_prompt();
        assert_eq!(state.prompt_input, "first\nsecond");
        state.move_prompt_end();
        state.kill_prompt_line_end();
        state.prompt_cursor = "first\n".len();
        state.kill_prompt_line_end();
        assert_eq!(state.prompt_input, "first\n");
        state.undo_prompt();
        state.redo_prompt();

        let mut empty = AppState::new(initialized_default_capabilities(), Vec::new());
        empty.delete_prompt_word_backward();
        empty.delete_prompt_word_forward();
        empty.kill_prompt_line_start();
        empty.kill_prompt_line_end();
        empty.yank_prompt();
        assert!(!empty.dismiss_prompt_suggestions());
        empty.prompt_input = "/m".to_string();
        empty.prompt_cursor = 2;
        empty.refresh_command_suggestions();
        assert!(empty.dismiss_prompt_suggestions());
        empty.replace_prompt_from_editor("/m".to_string());
        empty.replace_prompt_from_editor("changed".to_string());
        assert_eq!(empty.prompt_input, "changed");
        empty.replace_prompt_from_editor("x\n".repeat(8));
        assert_eq!(empty.pasted_blocks.len(), 1);

        for _ in 0..102 {
            empty.append_prompt('x');
        }
        assert_eq!(empty.prompt_undo_stack.len(), 100);

        assert_eq!(previous_word_boundary("  word", 6), 2);
        assert_eq!(previous_word_boundary("word+", 5), 4);
        assert_eq!(previous_word_boundary("", 0), 0);
        assert_eq!(next_word_boundary("word  next", 0), 6);
        assert_eq!(next_word_boundary("+word", 0), 1);
        assert_eq!(next_word_boundary("", 0), 0);
        assert!(is_word_character('_'));
        assert!(!is_word_character('+'));
    }
}
