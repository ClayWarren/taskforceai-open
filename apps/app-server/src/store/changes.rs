use rusqlite::params;
use serde_json::Value;

use super::{storage_error, SqliteRunStore};
use crate::{protocol::PendingChangeRecord, runtime::RuntimeError};

impl SqliteRunStore {
    pub fn list_pending_changes(&self) -> Result<Vec<PendingChangeRecord>, RuntimeError> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "select id, type, entity_id, operation, data, created_at \
                 from pending_changes order by created_at asc, id asc",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map([], |row| {
                let data: String = row.get(4)?;
                Ok(PendingChangeRecord {
                    id: Some(row.get(0)?),
                    change_type: row.get(1)?,
                    entity_id: row.get(2)?,
                    operation: row.get(3)?,
                    data: serde_json::from_str(&data).unwrap_or(Value::Null),
                    created_at: row.get(5)?,
                })
            })
            .map_err(storage_error)?;

        rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
    }

    pub fn add_pending_change(
        &self,
        change: &PendingChangeRecord,
    ) -> Result<PendingChangeRecord, RuntimeError> {
        let connection = self.open()?;
        let data = serde_json::to_string(&change.data).map_err(storage_error)?;
        connection
            .execute(
                "insert into pending_changes (type, entity_id, operation, data, created_at)
                 values (?1, ?2, ?3, ?4, ?5)",
                params![
                    change.change_type,
                    change.entity_id,
                    change.operation,
                    data,
                    change.created_at
                ],
            )
            .map_err(storage_error)?;
        let mut saved = change.clone();
        saved.id = Some(connection.last_insert_rowid());
        Ok(saved)
    }

    pub fn update_pending_change_data(&self, id: i64, data: &Value) -> Result<(), RuntimeError> {
        let connection = self.open()?;
        let encoded = serde_json::to_string(data).map_err(storage_error)?;
        connection
            .execute(
                "update pending_changes set data = ?1 where id = ?2",
                params![encoded, id],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    pub fn delete_pending_change(&self, id: i64) -> Result<(), RuntimeError> {
        let connection = self.open()?;
        connection
            .execute("delete from pending_changes where id = ?1", params![id])
            .map_err(storage_error)?;
        Ok(())
    }

    pub fn clear_pending_changes(&self) -> Result<(), RuntimeError> {
        let connection = self.open()?;
        connection
            .execute("delete from pending_changes", [])
            .map_err(storage_error)?;
        Ok(())
    }
}
