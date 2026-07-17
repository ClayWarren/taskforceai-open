use ratatui::layout::{Constraint, Direction, Layout, Rect};

use crate::state::AppState;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskPane {
    Conversations,
    Details,
}

pub fn task_pane_at(
    area: Rect,
    column: u16,
    row: u16,
    sidebar_collapsed: bool,
) -> Option<TaskPane> {
    let chunks = run_chunks(root_chunks(area)[1], sidebar_collapsed);
    if !sidebar_collapsed && contains(chunks[0], column, row) {
        Some(TaskPane::Conversations)
    } else if contains(chunks[1], column, row) {
        Some(TaskPane::Details)
    } else {
        None
    }
}

fn contains(area: Rect, column: u16, row: u16) -> bool {
    column >= area.x
        && column < area.x.saturating_add(area.width)
        && row >= area.y
        && row < area.y.saturating_add(area.height)
}

pub fn run_index_at(
    area: Rect,
    column: u16,
    row: u16,
    run_count: usize,
    scroll_offset: usize,
    sidebar_collapsed: bool,
) -> Option<usize> {
    if run_count == 0 || sidebar_collapsed {
        return None;
    }
    let runs_area = run_chunks(root_chunks(area)[1], sidebar_collapsed)[0];
    let first_row = runs_area.y.saturating_add(1);
    let last_row = runs_area
        .y
        .saturating_add(runs_area.height.saturating_sub(1));
    let first_column = runs_area.x.saturating_add(1);
    let last_column = runs_area
        .x
        .saturating_add(runs_area.width.saturating_sub(1));
    if row < first_row || row >= last_row || column < first_column || column >= last_column {
        return None;
    }
    let index = scroll_offset.saturating_add(usize::from(row - first_row));
    (index < run_count).then_some(index)
}

pub fn run_scroll_offset(area: Rect, state: &AppState) -> usize {
    if state.sidebar_collapsed {
        return 0;
    }
    let runs_area = run_chunks(root_chunks(area)[1], state.sidebar_collapsed)[0];
    let visible_rows = usize::from(runs_area.height.saturating_sub(2));
    if visible_rows == 0 {
        return 0;
    }
    let selected_index = state.selected_run_index().unwrap_or(0);
    selected_index.saturating_sub(visible_rows.saturating_sub(1))
}

pub(super) fn root_chunks(area: Rect) -> std::rc::Rc<[Rect]> {
    Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(4),
            Constraint::Min(5),
            Constraint::Length(8),
            Constraint::Length(3),
        ])
        .split(area)
}

pub(super) fn run_chunks(area: Rect, sidebar_collapsed: bool) -> std::rc::Rc<[Rect]> {
    if sidebar_collapsed {
        return Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Length(0), Constraint::Min(0)])
            .split(area);
    }

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(34), Constraint::Percentage(66)])
        .split(area)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_pane_hit_testing_covers_sidebar_and_outside_rows() {
        let area = Rect::new(0, 0, 120, 30);
        let task_area = root_chunks(area)[1];
        let chunks = run_chunks(task_area, false);
        assert_eq!(
            task_pane_at(area, chunks[0].x + 1, chunks[0].y + 1, false),
            Some(TaskPane::Conversations)
        );
        assert_eq!(task_pane_at(area, 0, 0, false), None);
    }
}
