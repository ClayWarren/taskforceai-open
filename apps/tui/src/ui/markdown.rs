use std::sync::OnceLock;

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use syntect::easy::HighlightLines;
use syntect::highlighting::{FontStyle, Theme, ThemeSet};
use syntect::parsing::SyntaxSet;

use super::style::{accent, action, danger, ok, panel_alt, text_faint, text_muted, warn};

static SYNTAX_SET: OnceLock<SyntaxSet> = OnceLock::new();
static SYNTAX_THEME: OnceLock<Theme> = OnceLock::new();

pub(super) fn markdown_lines(
    content: &str,
    base: Color,
    first_prefix: &'static str,
    rest_prefix: &'static str,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    let mut language: Option<String> = None;
    let source = content.lines().collect::<Vec<_>>();
    let mut index = 0_usize;
    while index < source.len() {
        let raw = source[index];
        if let Some(fence) = raw.trim().strip_prefix("```") {
            if language.is_some() {
                language = None;
            } else {
                let label = fence.trim();
                language = Some(label.to_string());
                lines.push(Line::from(vec![
                    Span::styled(rest_prefix, Style::default().fg(text_faint())),
                    Span::styled(
                        if label.is_empty() {
                            "code".to_string()
                        } else {
                            label.to_string()
                        },
                        Style::default()
                            .fg(accent())
                            .bg(panel_alt())
                            .add_modifier(Modifier::BOLD),
                    ),
                ]));
            }
            index += 1;
            continue;
        }

        let prefix = if lines.is_empty() {
            first_prefix
        } else {
            rest_prefix
        };
        if let Some(language) = language.as_deref() {
            lines.push(code_line(raw, language, prefix));
        } else if index + 1 < source.len()
            && raw.contains('|')
            && is_table_separator(source[index + 1])
        {
            let header = parse_table_row(raw);
            index += 2;
            let mut rows = Vec::new();
            while index < source.len()
                && source[index].contains('|')
                && !source[index].trim().is_empty()
            {
                rows.push(parse_table_row(source[index]));
                index += 1;
            }
            lines.extend(table_lines(&header, &rows, base, prefix, rest_prefix));
            continue;
        } else {
            lines.push(markdown_line(raw, base, prefix));
        }
        index += 1;
    }
    // coverage:ignore-start -- `str::lines` is empty only when `content` is empty, making this defensive fallback unreachable.
    if lines.is_empty() && !content.is_empty() {
        lines.push(Line::styled(content.to_string(), Style::default().fg(base)));
    }
    // coverage:ignore-end
    lines
}

pub(super) fn diff_lines(content: &str, prefix: &'static str) -> Vec<Line<'static>> {
    content
        .lines()
        .take(400)
        .map(|line| code_line(line, "diff", prefix))
        .collect()
}

fn parse_table_row(raw: &str) -> Vec<String> {
    raw.trim()
        .trim_matches('|')
        .split('|')
        .map(|cell| cell.trim().to_string())
        .collect()
}

fn is_table_separator(raw: &str) -> bool {
    let cells = parse_table_row(raw);
    !cells.is_empty()
        && cells.iter().all(|cell| {
            let cell = cell.trim_matches(':').trim();
            cell.len() >= 3 && cell.chars().all(|character| character == '-')
        })
}

fn table_lines(
    header: &[String],
    rows: &[Vec<String>],
    base: Color,
    first_prefix: &'static str,
    rest_prefix: &'static str,
) -> Vec<Line<'static>> {
    let columns = header
        .len()
        .max(rows.iter().map(Vec::len).max().unwrap_or_default());
    if columns == 0 {
        return Vec::new();
    }
    let widths = (0..columns)
        .map(|column| {
            std::iter::once(header.get(column).map(String::as_str).unwrap_or_default())
                .chain(
                    rows.iter()
                        .map(move |row| row.get(column).map(String::as_str).unwrap_or_default()),
                )
                .map(|cell| cell.chars().count().min(32))
                .max()
                .unwrap_or(1)
                .max(1)
        })
        .collect::<Vec<_>>();
    let border = |left: char, middle: char, right: char| {
        let mut value = String::new();
        value.push(left);
        for (index, width) in widths.iter().enumerate() {
            value.push_str(&"─".repeat(width + 2));
            value.push(if index + 1 == widths.len() {
                right
            } else {
                middle
            });
        }
        value
    };
    let mut lines = vec![Line::from(vec![
        Span::styled(first_prefix, Style::default().fg(text_faint())),
        Span::styled(border('┌', '┬', '┐'), Style::default().fg(text_faint())),
    ])];
    lines.push(table_row_line(header, &widths, base, rest_prefix, true));
    lines.push(Line::from(vec![
        Span::styled(rest_prefix, Style::default().fg(text_faint())),
        Span::styled(border('├', '┼', '┤'), Style::default().fg(text_faint())),
    ]));
    for row in rows {
        lines.push(table_row_line(row, &widths, base, rest_prefix, false));
    }
    lines.push(Line::from(vec![
        Span::styled(rest_prefix, Style::default().fg(text_faint())),
        Span::styled(border('└', '┴', '┘'), Style::default().fg(text_faint())),
    ]));
    lines
}

fn table_row_line(
    row: &[String],
    widths: &[usize],
    base: Color,
    prefix: &'static str,
    header: bool,
) -> Line<'static> {
    let mut spans = vec![
        Span::styled(prefix, Style::default().fg(text_faint())),
        Span::styled("│", Style::default().fg(text_faint())),
    ];
    for (column, width) in widths.iter().enumerate() {
        let cell = row.get(column).map(String::as_str).unwrap_or_default();
        let clipped = cell.chars().take(*width).collect::<String>();
        let padding = width.saturating_sub(clipped.chars().count());
        let style = if header {
            Style::default().fg(accent()).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(base)
        };
        spans.push(Span::styled(
            format!(" {clipped}{} ", " ".repeat(padding)),
            style,
        ));
        spans.push(Span::styled("│", Style::default().fg(text_faint())));
    }
    Line::from(spans)
}

fn markdown_line(raw: &str, base: Color, prefix: &'static str) -> Line<'static> {
    let trimmed = raw.trim_start();
    let (marker, body, style) = if let Some(body) = trimmed.strip_prefix("### ") {
        (
            "### ",
            body,
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        )
    } else if let Some(body) = trimmed.strip_prefix("## ") {
        (
            "## ",
            body,
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        )
    } else if let Some(body) = trimmed.strip_prefix("# ") {
        (
            "# ",
            body,
            Style::default()
                .fg(accent())
                .add_modifier(Modifier::BOLD | Modifier::UNDERLINED),
        )
    } else if let Some(body) = trimmed.strip_prefix("> ") {
        (
            "│ ",
            body,
            Style::default()
                .fg(text_muted())
                .add_modifier(Modifier::ITALIC),
        )
    } else if matches!(trimmed, "---" | "***" | "___") {
        ("────────", "", Style::default().fg(text_faint()))
    } else if let Some(body) = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
    {
        ("• ", body, Style::default().fg(base))
    } else if let Some((marker, body)) = ordered_list_item(trimmed) {
        (marker, body, Style::default().fg(base))
    } else {
        ("", raw, Style::default().fg(base))
    };
    let mut spans = vec![Span::styled(prefix, Style::default().fg(text_faint()))];
    if !marker.is_empty() {
        spans.push(Span::styled(marker.to_string(), style));
    }
    spans.extend(inline_spans(body, style));
    Line::from(spans)
}

fn ordered_list_item(value: &str) -> Option<(&str, &str)> {
    let marker_end = value
        .char_indices()
        .take_while(|(_, character)| character.is_ascii_digit())
        .last()
        .map(|(index, character)| index + character.len_utf8())?;
    let suffix = value.get(marker_end..)?;
    if !(suffix.starts_with(". ") || suffix.starts_with(") ")) {
        return None;
    }
    Some((&value[..marker_end + 2], &value[marker_end + 2..]))
}

fn inline_spans(value: &str, base: Style) -> Vec<Span<'static>> {
    let mut spans = Vec::new();
    let mut remaining = value;
    while !remaining.is_empty() {
        if let Some(after) = remaining.strip_prefix('[') {
            if let Some(label_end) = after.find("](") {
                let destination = &after[label_end + 2..];
                if let Some(url_end) = destination.find(')') {
                    let label = &after[..label_end];
                    let url = &destination[..url_end];
                    if is_link_url(url) {
                        spans.push(Span::styled(
                            label.to_string(),
                            base.add_modifier(Modifier::BOLD),
                        ));
                        spans.push(Span::styled(
                            format!(" ({url})"),
                            Style::default()
                                .fg(action())
                                .add_modifier(Modifier::UNDERLINED),
                        ));
                        remaining = &destination[url_end + 1..];
                        continue;
                    }
                }
            }
        }
        if remaining.starts_with("https://")
            || remaining.starts_with("http://")
            || remaining.starts_with("file://")
        {
            let end = remaining
                .find(char::is_whitespace)
                .unwrap_or(remaining.len());
            let (url, suffix) = trim_url_suffix(&remaining[..end]);
            spans.push(Span::styled(
                url.to_string(),
                Style::default()
                    .fg(action())
                    .add_modifier(Modifier::UNDERLINED),
            ));
            if !suffix.is_empty() {
                spans.push(Span::styled(suffix.to_string(), base));
            }
            remaining = &remaining[end..];
            continue;
        }
        let code = remaining.find('`');
        let bold = remaining.find("**");
        let strike = remaining.find("~~");
        let italic_star = remaining.find('*');
        let italic_underscore = remaining.find('_');
        let link = [
            remaining.find("https://"),
            remaining.find("http://"),
            remaining.find("file://"),
            remaining.find('['),
        ]
        .into_iter()
        .flatten()
        .min();
        let next = [code, bold, strike, italic_star, italic_underscore, link]
            .into_iter()
            .flatten()
            .min();
        let Some(next) = next else {
            spans.push(Span::styled(remaining.to_string(), base));
            break;
        };
        if next > 0 {
            spans.push(Span::styled(remaining[..next].to_string(), base));
            remaining = &remaining[next..];
            continue;
        }
        if let Some(after) = remaining.strip_prefix("**") {
            if let Some(end) = after.find("**") {
                spans.push(Span::styled(
                    after[..end].to_string(),
                    base.add_modifier(Modifier::BOLD),
                ));
                remaining = &after[end + 2..];
                continue;
            }
        }
        if let Some(after) = remaining.strip_prefix("~~") {
            if let Some(end) = after.find("~~") {
                spans.push(Span::styled(
                    after[..end].to_string(),
                    base.add_modifier(Modifier::CROSSED_OUT),
                ));
                remaining = &after[end + 2..];
                continue;
            }
        }
        let mut handled_italic = false;
        for delimiter in ['*', '_'] {
            if let Some(after) = remaining.strip_prefix(delimiter) {
                if let Some(end) = after.find(delimiter) {
                    spans.push(Span::styled(
                        after[..end].to_string(),
                        base.add_modifier(Modifier::ITALIC),
                    ));
                    remaining = &after[end + delimiter.len_utf8()..];
                    handled_italic = true;
                    break;
                }
            }
        }
        if handled_italic {
            continue;
        }
        if let Some(after) = remaining.strip_prefix('`') {
            if let Some(end) = after.find('`') {
                spans.push(Span::styled(
                    after[..end].to_string(),
                    Style::default().fg(warn()).bg(panel_alt()),
                ));
                remaining = &after[end + 1..];
                continue;
            }
        }
        let character = remaining
            .chars()
            .next()
            .expect("remaining text is not empty");
        spans.push(Span::styled(character.to_string(), base));
        remaining = &remaining[character.len_utf8()..];
    }
    spans
}

fn is_link_url(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://") || value.starts_with("file://")
}

fn trim_url_suffix(value: &str) -> (&str, &str) {
    let trimmed = value.trim_end_matches(['.', ',', ';', ':', '!', '?', ')', ']']);
    (&value[..trimmed.len()], &value[trimmed.len()..])
}

fn code_line(raw: &str, language: &str, prefix: &'static str) -> Line<'static> {
    let mut spans = vec![Span::styled(prefix, Style::default().fg(text_faint()))];
    let diff = matches!(language, "diff" | "patch");
    if diff && raw.starts_with('+') && !raw.starts_with("+++") {
        spans.push(Span::styled(
            raw.to_string(),
            Style::default().fg(ok()).bg(panel_alt()),
        ));
    } else if diff && raw.starts_with('-') && !raw.starts_with("---") {
        spans.push(Span::styled(
            raw.to_string(),
            Style::default().fg(danger()).bg(panel_alt()),
        ));
    } else if diff && (raw.starts_with("@@") || raw.starts_with("diff ")) {
        spans.push(Span::styled(
            raw.to_string(),
            Style::default().fg(action()).bg(panel_alt()),
        ));
    } else {
        spans.extend(
            highlight_language_line(raw, language).unwrap_or_else(|| highlight_tokens(raw)),
        );
    }
    Line::from(spans)
}

fn highlight_language_line(raw: &str, language: &str) -> Option<Vec<Span<'static>>> {
    if language.trim().is_empty() {
        return None;
    }
    let syntaxes = SYNTAX_SET.get_or_init(two_face::syntax::extra_newlines);
    let token = language
        .split(|character: char| character.is_ascii_whitespace() || character == ',')
        .next()
        .unwrap_or(language);
    let syntax = syntaxes
        .find_syntax_by_token(token)
        .or_else(|| syntaxes.find_syntax_by_extension(token))?;
    let theme = SYNTAX_THEME.get_or_init(|| {
        let mut themes = ThemeSet::load_defaults().themes;
        themes
            .remove("base16-ocean.dark")
            .or_else(|| themes.into_values().next())
            .expect("syntect ships at least one default theme")
    });
    let mut highlighter = HighlightLines::new(syntax, theme);
    let source = format!("{raw}\n");
    let highlighted = highlighter.highlight_line(&source, syntaxes).ok()?;
    Some(
        highlighted
            .into_iter()
            .filter_map(|(style, value)| {
                let value = value.strip_suffix('\n').unwrap_or(value);
                if value.is_empty() {
                    return None;
                }
                let mut modifier = Modifier::empty();
                // coverage:ignore-start -- modifier combinations depend on syntect's bundled theme metadata.
                if style.font_style.contains(FontStyle::BOLD) {
                    modifier |= Modifier::BOLD;
                }
                if style.font_style.contains(FontStyle::ITALIC) {
                    modifier |= Modifier::ITALIC;
                }
                if style.font_style.contains(FontStyle::UNDERLINE) {
                    modifier |= Modifier::UNDERLINED;
                }
                // coverage:ignore-end
                Some(Span::styled(
                    value.to_string(),
                    Style::default()
                        .fg(Color::Rgb(
                            style.foreground.r,
                            style.foreground.g,
                            style.foreground.b,
                        ))
                        .bg(panel_alt())
                        .add_modifier(modifier),
                ))
            })
            .collect(),
    )
}

fn highlight_tokens(raw: &str) -> Vec<Span<'static>> {
    const KEYWORDS: &[&str] = &[
        "async", "await", "class", "const", "def", "else", "enum", "fn", "for", "func", "if",
        "impl", "import", "let", "match", "pub", "return", "struct", "use", "var", "while",
    ];
    let mut spans = Vec::new();
    for token in raw.split_inclusive(char::is_whitespace) {
        let word =
            token.trim_matches(|character: char| !character.is_alphanumeric() && character != '_');
        let style = if KEYWORDS.contains(&word) {
            Style::default()
                .fg(accent())
                .bg(panel_alt())
                .add_modifier(Modifier::BOLD)
        } else if token.trim_start().starts_with("//") || token.trim_start().starts_with('#') {
            Style::default()
                .fg(text_muted())
                .bg(panel_alt())
                .add_modifier(Modifier::ITALIC)
        } else if word.parse::<f64>().is_ok() {
            Style::default().fg(warn()).bg(panel_alt())
        } else {
            Style::default().fg(Color::White).bg(panel_alt())
        };
        spans.push(Span::styled(token.to_string(), style));
    }
    spans
}

#[cfg(test)]
mod tests {
    use ratatui::style::Color;

    use super::*;

    #[test]
    fn renders_markdown_and_fenced_diff_lines() {
        let rendered = markdown_lines(
            "# Heading\nUse **bold** and `code`.\n```diff\n-old\n+new\n```",
            Color::White,
            "• ",
            "  ",
        );
        assert_eq!(rendered.len(), 5);
        assert!(rendered[0]
            .spans
            .iter()
            .any(|span| span.content.contains("Heading")));
        assert!(rendered[4]
            .spans
            .iter()
            .any(|span| span.content.contains("+new")));
    }

    #[test]
    fn renders_tables_ordered_lists_and_extended_inline_styles() {
        let rendered = markdown_lines(
            "| Mode | Purpose |\n| --- | --- |\n| chat | answer |\n| code | build |\n\n1. First\n2. Use *italics* and ~~removed~~",
            Color::White,
            "",
            "",
        );
        let text = rendered
            .iter()
            .flat_map(|line| &line.spans)
            .map(|span| span.content.as_ref())
            .collect::<String>();
        assert!(text.contains("┌"));
        assert!(text.contains("Mode"));
        assert!(text.contains("chat"));
        assert!(text.contains("1. First"));
        assert!(rendered.iter().flat_map(|line| &line.spans).any(|span| span
            .style
            .add_modifier
            .contains(ratatui::style::Modifier::CROSSED_OUT)));
    }

    #[test]
    fn known_fence_languages_use_syntax_aware_token_colors() {
        let spans = highlight_language_line("fn main() { let ready = true; }", "rust")
            .expect("Rust syntax should be available");
        let first = spans.first().and_then(|span| span.style.fg);

        assert!(spans.iter().any(|span| span.style.fg != first));
    }

    #[test]
    fn markdown_helpers_cover_blocks_links_fallbacks_and_diff_shapes() {
        let rendered = markdown_lines(
            "### Three\n## Two\n# One\n> quote\n---\n***\n___\n- dash\n* star\n3) ordered\nnot) ordered\n[site](https://example.com) and [file](file:///tmp/a)\nhttps://example.com/path). http://example.com! file:///tmp/a,\n*italic* _also_ **bold** ~~gone~~ `code`\nunclosed ** ~~ * _ ` [bad](ftp://no)\n```\nplain code\n```\n```unknown\nfn value 42 #comment\n```",
            Color::White,
            "• ",
            "  ",
        );
        let text = rendered
            .iter()
            .flat_map(|line| &line.spans)
            .map(|span| span.content.as_ref())
            .collect::<String>();
        for expected in [
            "Three",
            "Two",
            "One",
            "quote",
            "site",
            "https://example.com",
        ] {
            assert!(text.contains(expected));
        }

        assert!(ordered_list_item("12. item").is_some());
        assert!(ordered_list_item("12) item").is_some());
        assert!(ordered_list_item("12 item").is_none());
        assert!(!is_table_separator("| -- | nope |"));
        assert!(table_lines(&[], &[], Color::White, "", "").is_empty());
        assert!(is_link_url("http://example.com"));
        assert!(!is_link_url("ftp://example.com"));
        assert_eq!(
            trim_url_suffix("https://example.com)."),
            ("https://example.com", ").")
        );

        for raw in [
            "+added",
            "-removed",
            "@@ hunk",
            "diff --git a b",
            "+++ header",
            "--- header",
        ] {
            assert!(!code_line(raw, "diff", "  ").spans.is_empty());
        }
        assert!(highlight_language_line("plain", "").is_none());
        assert!(highlight_language_line("plain", "not-a-language").is_none());
        let fallback = highlight_tokens("fn value 42 // comment");
        assert_eq!(fallback.len(), 5);
        assert_eq!(diff_lines("+a\n-b", "").len(), 2);
    }

    #[test]
    fn empty_and_non_line_terminated_markdown_keep_content_visible() {
        assert!(markdown_lines("", Color::White, "", "").is_empty());
        let content = "single line without newline";
        let rendered = markdown_lines(content, Color::White, "", "");
        assert_eq!(rendered.len(), 1);
        assert!(rendered[0]
            .spans
            .iter()
            .any(|span| span.content.contains("single line")));
    }
}
