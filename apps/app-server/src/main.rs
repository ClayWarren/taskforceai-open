use std::io::{self, Write};
use std::net::IpAddr;

use taskforceai_app_server::{run_http, run_stdio, HttpServerConfig};
use tokio::io::BufReader;

const PAIRING_CODE_ENV: &str = "TASKFORCE_APP_SERVER_PAIRING_CODE";

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--version") {
        println!("taskforceai-app-server {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("app-server runtime should start");
    runtime.block_on(run());
    runtime.shutdown_background();
}

async fn run() {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("serve") {
        if let Err(err) = run_serve(args.collect()).await {
            write_error(&err.to_string());
            std::process::exit(1);
        }
        return;
    }

    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    let stderr = tokio::io::stderr();

    if let Err(err) = run_stdio(BufReader::new(stdin), stdout, stderr).await {
        write_error(&err.to_string());
        std::process::exit(1);
    }
}

async fn run_serve(args: Vec<String>) -> Result<(), Box<dyn std::error::Error>> {
    let mut config = HttpServerConfig::default();
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--host" => {
                index += 1;
                let host = args
                    .get(index)
                    .ok_or("--host requires an IP address")?
                    .parse::<IpAddr>()?;
                config.host = host;
            }
            "--port" => {
                index += 1;
                config.port = args.get(index).ok_or("--port requires a value")?.parse()?;
            }
            "--pairing-code" => {
                index += 1;
                config.pairing_code = Some(
                    args.get(index)
                        .ok_or("--pairing-code requires a value")?
                        .to_string(),
                );
            }
            "--allow-non-loopback" => {
                config.allow_non_loopback = true;
            }
            "--advertise-host" => {
                index += 1;
                config.advertise_host = Some(
                    args.get(index)
                        .ok_or("--advertise-host requires an IP address")?
                        .parse::<IpAddr>()?,
                );
            }
            other => return Err(format!("unknown serve argument: {other}").into()),
        }
        index += 1;
    }
    if config.pairing_code.is_none() {
        config.pairing_code = std::env::var(PAIRING_CODE_ENV)
            .ok()
            .filter(|value| !value.trim().is_empty());
    }
    if config.pairing_code.is_none() {
        return Err("serve requires --pairing-code or TASKFORCE_APP_SERVER_PAIRING_CODE".into());
    }

    run_http(config).await?;
    Ok(())
}

fn write_error(message: &str) {
    let _ = writeln!(
        io::stderr(),
        "{}",
        serde_json::json!({
            "level": "error",
            "target": "taskforceai_app_server",
            "message": message,
        })
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn serve_requires_explicit_pairing_code() {
        std::env::remove_var(PAIRING_CODE_ENV);

        let err = run_serve(vec!["--port".to_string(), "0".to_string()])
            .await
            .expect_err("serve should fail closed without a pairing code");

        assert!(
            err.to_string().contains("requires --pairing-code"),
            "unexpected error: {err}"
        );
    }
}
