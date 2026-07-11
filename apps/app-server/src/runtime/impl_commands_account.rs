use crate::protocol::*;

use super::error::RuntimeError;
use super::format::*;

impl super::AppRuntime {
    pub(crate) async fn handle_account_usage_command(
        &mut self,
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let Some(token) = self.auth_token()? else {
            return Ok(CommandExecuteResult {
                handled: false,
                title: "Account".to_string(),
                message: "Login required. Use /login first.".to_string(),
            });
        };
        let user = self
            .api_client
            .current_user(&token)
            .await
            .map_err(|err| RuntimeError::network(err.detailed_message()))?;
        let balance = self.api_client.billing_balance(&token).await.ok();
        Ok(CommandExecuteResult {
            handled: true,
            title: "Account".to_string(),
            message: format_account_usage(&user, balance.as_ref()),
        })
    }
}
