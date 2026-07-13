use rusqlite::params;

use super::{SqliteRunStore, StoreResult};

impl SqliteRunStore {
    pub fn get_metadata(&self, key: &str) -> StoreResult<Option<String>> {
        let connection = self.open()?;
        let mut statement =
            connection.prepare("select value from metadata where key = ?1 limit 1")?;
        let result = statement.query_row(params![key], |row| row.get(0));
        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(err.into()), // coverage:ignore-line
        }
    }

    pub fn set_metadata(&self, key: &str, value: &str) -> StoreResult<()> {
        let connection = self.open()?;
        connection.execute(
            "insert into metadata (key, value) values (?1, ?2)
                on conflict(key) do update set value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn clear_all(&self) -> StoreResult<()> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        transaction.execute("delete from messages", [])?;
        transaction.execute("delete from conversations", [])?;
        transaction.execute("delete from pending_changes", [])?;
        transaction.execute("delete from pending_prompts", [])?;
        transaction.execute("delete from prompt_queue", [])?;
        transaction.execute("delete from metadata", [])?;
        transaction.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_metadata_returns_none_for_missing_keys() {
        let path = std::env::temp_dir().join(format!(
            "taskforceai-store-metadata-missing-{}-{}.sqlite3",
            std::process::id(),
            crate::test_unix_millis()
        ));
        let store = SqliteRunStore::new(path.clone());

        assert_eq!(
            store
                .get_metadata("missing")
                .expect("missing metadata should not error"),
            None
        );

        let _ = std::fs::remove_file(path);
    }
}
