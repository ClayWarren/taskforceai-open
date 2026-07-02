use rusqlite::params;

use super::{storage_error, SqliteRunStore};
use crate::runtime::RuntimeError;

impl SqliteRunStore {
    pub fn get_metadata(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare("select value from metadata where key = ?1 limit 1")
            .map_err(storage_error)?;
        let result = statement.query_row(params![key], |row| row.get(0));
        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(storage_error(err)), // coverage:ignore-line
        }
    }

    pub fn set_metadata(&self, key: &str, value: &str) -> Result<(), RuntimeError> {
        let connection = self.open()?;
        connection
            .execute(
                "insert into metadata (key, value) values (?1, ?2)
                on conflict(key) do update set value = excluded.value",
                params![key, value],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    pub fn clear_all(&self) -> Result<(), RuntimeError> {
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        transaction
            .execute("delete from messages", [])
            .map_err(storage_error)?;
        transaction
            .execute("delete from conversations", [])
            .map_err(storage_error)?;
        transaction
            .execute("delete from pending_changes", [])
            .map_err(storage_error)?;
        transaction
            .execute("delete from pending_prompts", [])
            .map_err(storage_error)?;
        transaction
            .execute("delete from prompt_queue", [])
            .map_err(storage_error)?;
        transaction
            .execute("delete from metadata", [])
            .map_err(storage_error)?;
        transaction.commit().map_err(storage_error)?;
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
            crate::runtime::unix_millis()
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
