use super::{AppState, FocusArea};

impl AppState {
    pub(super) fn append_prompt(&mut self, value: char) {
        if value.is_control() {
            return;
        }
        self.normalize_prompt_cursor();
        self.prompt_input.insert(self.prompt_cursor, value);
        self.prompt_cursor += value.len_utf8();
        self.after_prompt_edit();
    }

    pub fn paste_prompt(&mut self, value: &str) {
        let value = value.replace("\r\n", "\n").replace('\r', "\n");
        self.normalize_prompt_cursor();
        self.prompt_input.insert_str(self.prompt_cursor, &value);
        self.prompt_cursor += value.len();
        self.after_prompt_edit();
    }

    pub fn insert_prompt_newline(&mut self) {
        self.normalize_prompt_cursor();
        self.prompt_input.insert(self.prompt_cursor, '\n');
        self.prompt_cursor += 1;
        self.after_prompt_edit();
    }

    pub fn backspace_prompt(&mut self) {
        self.normalize_prompt_cursor();
        let Some(previous) = previous_boundary(&self.prompt_input, self.prompt_cursor) else {
            return;
        };
        self.prompt_input.drain(previous..self.prompt_cursor);
        self.prompt_cursor = previous;
        self.after_prompt_edit();
    }

    pub fn delete_prompt(&mut self) {
        self.normalize_prompt_cursor();
        let Some(next) = next_boundary(&self.prompt_input, self.prompt_cursor) else {
            return;
        };
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
            if self.prompt_history.len() > 200 {
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
                self.prompt_history_draft = self.prompt_input.clone();
                self.prompt_history.len().saturating_sub(1)
            }
        };
        self.prompt_history_index = Some(next);
        self.prompt_input = self.prompt_history[next].clone();
        self.prompt_cursor = self.prompt_input.len();
        self.refresh_command_suggestions();
        self.file_suggestions.clear();
        self.selected_file_suggestion = None;
    }

    pub fn next_prompt_history(&mut self) {
        let Some(index) = self.prompt_history_index else {
            return;
        };
        if index + 1 < self.prompt_history.len() {
            let next = index + 1;
            self.prompt_history_index = Some(next);
            self.prompt_input = self.prompt_history[next].clone();
        } else {
            self.prompt_history_index = None;
            self.prompt_input = std::mem::take(&mut self.prompt_history_draft);
        }
        self.prompt_cursor = self.prompt_input.len();
        self.refresh_command_suggestions();
        self.file_suggestions.clear();
        self.selected_file_suggestion = None;
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
        self.focus == FocusArea::Prompt && !self.file_suggestions.is_empty()
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
        self.file_suggestions.clear();
        self.selected_file_suggestion = None;
        self.refresh_command_suggestions();
    }

    fn after_prompt_edit(&mut self) {
        self.prompt_history_index = None;
        self.refresh_command_suggestions();
        if self.mention_query().is_none() {
            self.file_suggestions.clear();
            self.selected_file_suggestion = None;
        }
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
}
