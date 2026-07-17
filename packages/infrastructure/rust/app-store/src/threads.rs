use rusqlite::{params, OptionalExtension, Row, Transaction};
use taskforceai_app_protocol::{ThreadItemRecord, ThreadRecord, TurnRecord};

use super::{SqliteRunStore, StoreError, StoreResult};

const DEFAULT_PAGE_LIMIT: usize = 50;
const MAX_PAGE_LIMIT: usize = 200;

impl SqliteRunStore {
    pub fn replace_threads(&self, threads: &[ThreadRecord]) -> StoreResult<()> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        transaction.execute("delete from app_threads", [])?;
        for thread in threads {
            write_thread(&transaction, thread)?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn upsert_thread(&self, thread: &ThreadRecord) -> StoreResult<()> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        write_thread(&transaction, thread)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn delete_thread(&self, thread_id: &str) -> StoreResult<bool> {
        let connection = self.open()?;
        Ok(connection.execute("delete from app_threads where id = ?1", params![thread_id])? > 0)
    }

    pub fn has_threads(&self) -> StoreResult<bool> {
        let connection = self.open()?;
        Ok(connection
            .query_row("select 1 from app_threads limit 1", [], |_| Ok(()))
            .optional()?
            .is_some())
    }

    pub fn load_all_threads(&self) -> StoreResult<Vec<ThreadRecord>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
            "select id, title, objective, state, archived, source, task_mode, parent_thread_id, created_at, updated_at
             from app_threads order by updated_at desc, id desc",
        )?;
        let summaries = statement
            .query_map([], thread_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        summaries
            .into_iter()
            .map(|thread| hydrate_thread(&connection, thread, true))
            .collect()
    }

    pub fn get_thread(&self, thread_id: &str) -> StoreResult<Option<ThreadRecord>> {
        let connection = self.open()?;
        let summary = connection
            .query_row(
                "select id, title, objective, state, archived, source, task_mode, parent_thread_id, created_at, updated_at
                 from app_threads where id = ?1",
                params![thread_id],
                thread_from_row,
            )
            .optional()?;
        summary
            .map(|thread| hydrate_thread(&connection, thread, true))
            .transpose()
    }

    pub fn list_threads_page(
        &self,
        cursor: Option<&str>,
        limit: Option<usize>,
        include_turns: bool,
        archived: Option<bool>,
    ) -> StoreResult<(Vec<ThreadRecord>, Option<String>)> {
        let connection = self.open()?;
        let limit = page_limit(limit);
        let (cursor_updated_at, cursor_id) = decode_cursor(cursor)?;
        let archived = archived.map(i64::from);
        let mut statement = connection.prepare(
            "select id, title, objective, state, archived, source, task_mode, parent_thread_id, created_at, updated_at
             from app_threads
             where (?1 is null or archived = ?1)
               and (?2 is null or updated_at < ?2 or (updated_at = ?2 and id < ?3))
             order by updated_at desc, id desc limit ?4",
        )?;
        let summaries = statement
            .query_map(
                params![archived, cursor_updated_at, cursor_id, (limit + 1) as i64],
                thread_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let has_more = summaries.len() > limit;
        let mut threads = summaries.into_iter().take(limit).collect::<Vec<_>>();
        if include_turns {
            threads = threads
                .into_iter()
                .map(|thread| hydrate_thread(&connection, thread, true))
                .collect::<StoreResult<Vec<_>>>()?;
        }
        let next_cursor = has_more
            .then(|| {
                threads
                    .last()
                    .map(|thread| encode_cursor(thread.updated_at, &thread.id))
            })
            .flatten();
        Ok((threads, next_cursor))
    }

    pub fn list_thread_turns_page(
        &self,
        thread_id: &str,
        cursor: Option<&str>,
        limit: Option<usize>,
        include_items: bool,
    ) -> StoreResult<(Vec<TurnRecord>, Option<String>)> {
        let connection = self.open()?;
        let limit = page_limit(limit);
        let offset = decode_offset(cursor)?;
        let mut statement = connection.prepare(
            "select id, thread_id, run_id, status, created_at, updated_at
             from app_turns where thread_id = ?1 order by position desc limit ?2 offset ?3",
        )?;
        let mut turns = statement
            .query_map(
                params![thread_id, (limit + 1) as i64, offset as i64],
                turn_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let has_more = turns.len() > limit;
        turns.truncate(limit);
        if include_items {
            for turn in &mut turns {
                turn.items = load_turn_items(&connection, &turn.id)?;
            }
        }
        Ok((turns, has_more.then(|| (offset + limit).to_string())))
    }

    pub fn list_thread_items_page(
        &self,
        thread_id: &str,
        turn_id: Option<&str>,
        cursor: Option<&str>,
        limit: Option<usize>,
    ) -> StoreResult<(Vec<ThreadItemRecord>, Option<String>)> {
        let connection = self.open()?;
        let limit = page_limit(limit);
        let offset = decode_offset(cursor)?;
        let mut statement = connection.prepare(
            "select id, turn_id, item_type, status, content, created_at, updated_at
             from app_thread_items
             where thread_id = ?1 and (?2 is null or turn_id = ?2)
             order by created_at desc, id desc limit ?3 offset ?4",
        )?;
        let mut items = statement
            .query_map(
                params![thread_id, turn_id, (limit + 1) as i64, offset as i64],
                item_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let has_more = items.len() > limit;
        items.truncate(limit);
        Ok((items, has_more.then(|| (offset + limit).to_string())))
    }
}

fn write_thread(transaction: &Transaction<'_>, thread: &ThreadRecord) -> StoreResult<()> {
    transaction.execute(
        "insert into app_threads (id, title, objective, state, archived, source, task_mode, parent_thread_id, created_at, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         on conflict(id) do update set title=excluded.title, objective=excluded.objective,
             state=excluded.state, archived=excluded.archived, source=excluded.source,
             task_mode=excluded.task_mode, parent_thread_id=excluded.parent_thread_id,
             created_at=excluded.created_at, updated_at=excluded.updated_at",
        params![
            thread.id,
            thread.title,
            thread.objective,
            serde_json::to_string(&thread.state)?,
            i64::from(thread.archived),
            thread.source,
            serde_json::to_string(&thread.task_mode)?,
            thread.parent_thread_id,
            thread.created_at as i64,
            thread.updated_at as i64,
        ],
    )?;
    transaction.execute(
        "delete from app_turns where thread_id = ?1",
        params![thread.id],
    )?;
    for (turn_position, turn) in thread.turns.iter().enumerate() {
        transaction.execute(
            "insert into app_turns (id, thread_id, run_id, status, position, created_at, updated_at)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                turn.id,
                thread.id,
                turn.run_id,
                serde_json::to_string(&turn.status)?,
                turn_position as i64,
                turn.created_at as i64,
                turn.updated_at as i64,
            ],
        )?;
        for (item_position, item) in turn.items.iter().enumerate() {
            transaction.execute(
                "insert into app_thread_items (id, thread_id, turn_id, item_type, status, content, position, created_at, updated_at)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    item.id,
                    thread.id,
                    turn.id,
                    serde_json::to_string(&item.item_type)?,
                    serde_json::to_string(&item.status)?,
                    serde_json::to_string(&item.content)?,
                    item_position as i64,
                    item.created_at as i64,
                    item.updated_at as i64,
                ],
            )?;
        }
    }
    Ok(())
}

fn thread_from_row(row: &Row<'_>) -> rusqlite::Result<ThreadRecord> {
    let state: String = row.get(3)?;
    let task_mode: String = row.get(6)?;
    Ok(ThreadRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        objective: row.get(2)?,
        state: decode_json(&state, 3)?,
        archived: row.get::<_, i64>(4)? != 0,
        source: row.get(5)?,
        task_mode: decode_json(&task_mode, 6)?,
        parent_thread_id: row.get(7)?,
        turns: Vec::new(),
        created_at: row.get::<_, i64>(8)? as u64,
        updated_at: row.get::<_, i64>(9)? as u64,
    })
}

fn turn_from_row(row: &Row<'_>) -> rusqlite::Result<TurnRecord> {
    let status: String = row.get(3)?;
    Ok(TurnRecord {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        run_id: row.get(2)?,
        status: decode_json(&status, 3)?,
        items: Vec::new(),
        created_at: row.get::<_, i64>(4)? as u64,
        updated_at: row.get::<_, i64>(5)? as u64,
    })
}

fn item_from_row(row: &Row<'_>) -> rusqlite::Result<ThreadItemRecord> {
    let item_type: String = row.get(2)?;
    let status: String = row.get(3)?;
    let content: String = row.get(4)?;
    Ok(ThreadItemRecord {
        id: row.get(0)?,
        turn_id: row.get(1)?,
        item_type: decode_json(&item_type, 2)?,
        status: decode_json(&status, 3)?,
        content: decode_json(&content, 4)?,
        created_at: row.get::<_, i64>(5)? as u64,
        updated_at: row.get::<_, i64>(6)? as u64,
    })
}

fn hydrate_thread(
    connection: &rusqlite::Connection,
    mut thread: ThreadRecord,
    include_items: bool,
) -> StoreResult<ThreadRecord> {
    let mut statement = connection.prepare(
        "select id, thread_id, run_id, status, created_at, updated_at
         from app_turns where thread_id = ?1 order by position asc",
    )?;
    thread.turns = statement
        .query_map(params![thread.id], turn_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    if include_items {
        for turn in &mut thread.turns {
            turn.items = load_turn_items(connection, &turn.id)?;
        }
    }
    Ok(thread)
}

fn load_turn_items(
    connection: &rusqlite::Connection,
    turn_id: &str,
) -> StoreResult<Vec<ThreadItemRecord>> {
    let mut statement = connection.prepare(
        "select id, turn_id, item_type, status, content, created_at, updated_at
         from app_thread_items where turn_id = ?1 order by position asc",
    )?;
    let items = statement
        .query_map(params![turn_id], item_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

fn decode_json<T: serde::de::DeserializeOwned>(value: &str, column: usize) -> rusqlite::Result<T> {
    serde_json::from_str(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn page_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(DEFAULT_PAGE_LIMIT).clamp(1, MAX_PAGE_LIMIT)
}

fn encode_cursor(updated_at: u64, id: &str) -> String {
    format!("{updated_at}|{id}")
}

fn decode_cursor(cursor: Option<&str>) -> StoreResult<(Option<i64>, Option<String>)> {
    let Some(cursor) = cursor.filter(|cursor| !cursor.trim().is_empty()) else {
        return Ok((None, None));
    };
    let (updated_at, id) = cursor
        .split_once('|')
        .ok_or_else(|| StoreError::new("invalid thread cursor"))?;
    let updated_at = updated_at
        .parse::<i64>()
        .map_err(|_| StoreError::new("invalid thread cursor"))?;
    Ok((Some(updated_at), Some(id.to_string())))
}

fn decode_offset(cursor: Option<&str>) -> StoreResult<usize> {
    cursor
        .filter(|cursor| !cursor.trim().is_empty())
        .map(str::parse::<usize>)
        .transpose()
        .map_err(|_| StoreError::new("invalid page cursor"))
        .map(Option::unwrap_or_default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use taskforceai_app_protocol::{
        TaskMode, ThreadItemStatus, ThreadItemType, ThreadState, TurnStatus,
    };

    fn thread(id: &str, updated_at: u64) -> ThreadRecord {
        ThreadRecord {
            id: id.to_string(),
            title: format!("Thread {id}"),
            objective: "test".to_string(),
            state: ThreadState::Active,
            archived: false,
            source: "test".to_string(),
            task_mode: TaskMode::Chat,
            parent_thread_id: None,
            turns: vec![TurnRecord {
                id: format!("turn-{id}"),
                thread_id: id.to_string(),
                run_id: format!("run-{id}"),
                status: TurnStatus::Completed,
                items: vec![ThreadItemRecord {
                    id: format!("item-{id}"),
                    turn_id: format!("turn-{id}"),
                    item_type: ThreadItemType::AgentMessage,
                    status: ThreadItemStatus::Completed,
                    content: serde_json::json!({"text": id}),
                    created_at: updated_at,
                    updated_at,
                }],
                created_at: updated_at,
                updated_at,
            }],
            created_at: updated_at,
            updated_at,
        }
    }

    #[test]
    fn normalized_threads_round_trip_and_paginate() {
        let path = std::env::temp_dir().join(format!(
            "taskforceai-thread-store-{}-{}.sqlite",
            std::process::id(),
            crate::test_unix_millis()
        ));
        let store = SqliteRunStore::new(path.clone());
        store
            .replace_threads(&[thread("one", 1), thread("two", 2)])
            .expect("replace threads");
        let (first, cursor) = store
            .list_threads_page(None, Some(1), false, None)
            .expect("first page");
        assert_eq!(first[0].id, "two");
        assert!(first[0].turns.is_empty());
        let (second, next) = store
            .list_threads_page(cursor.as_deref(), Some(1), true, None)
            .expect("second page");
        assert_eq!(second[0].turns[0].items[0].content["text"], "one");
        assert!(next.is_none());
        let _ = std::fs::remove_file(path);
    }
}
