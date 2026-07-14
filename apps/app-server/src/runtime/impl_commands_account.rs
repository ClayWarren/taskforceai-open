use crate::protocol::*;

use super::error::RuntimeError;
use super::format::*;
use super::util::{command_message, command_unhandled};

impl super::AppRuntime {
    pub(crate) async fn handle_account_usage_command(
        &mut self,
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let Some(token) = self.auth_token()? else {
            return Ok(command_unhandled(
                "Account",
                "Login required. Use /login first.",
            ));
        };
        let user = self
            .api_client
            .current_user(&token)
            .await
            .map_err(|err| RuntimeError::network(err.detailed_message()))?;
        let balance = self.api_client.billing_balance(&token).await.ok();
        Ok(command_message(
            "Account",
            format_account_usage(&user, balance.as_ref()),
        ))
    }
}
