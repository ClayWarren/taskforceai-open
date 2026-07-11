use ratatui::layout::{Constraint, Direction, Layout, Rect};

use crate::state::AppState;

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
            Constraint::Length(3),
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
