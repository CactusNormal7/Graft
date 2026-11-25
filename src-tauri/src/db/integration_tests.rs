//! Tests against real Postgres / MySQL servers. Each test is skipped (passes
//! without doing anything) unless its environment variable is set, e.g.:
//!
//! ```text
//! GRAFT_TEST_POSTGRES="host=127.0.0.1 port=5432 user=postgres password=secret dbname=postgres"
//! GRAFT_TEST_MYSQL="host=127.0.0.1 port=3306 user=graft password=secret dbname=graft_test"
//! ```
//!
//! They create and drop their own objects (prefixed `graft_it_`). See
//! docs/technique.md § Tests d'intégration for starting throwaway servers.

use std::collections::HashMap;

use super::config::{ConnectionConfig, Engine, SslMode};
use super::{test_connection, Databases};

const POSTGRES_ENV: &str = "GRAFT_TEST_POSTGRES";
const MYSQL_ENV: &str = "GRAFT_TEST_MYSQL";

/// Connection + password from a `key=value key=value` environment variable.
fn from_env(variable: &str, engine: Engine) -> Option<(ConnectionConfig, Option<String>)> {
    let raw = std::env::var(variable).ok()?;
    let fields: HashMap<&str, &str> = raw
        .split_whitespace()
        .filter_map(|pair| pair.split_once('='))
        .collect();
    let config = ConnectionConfig {
        id: format!("it-{variable}"),
        engine,
        path: None,
        host: fields.get("host").map(|v| v.to_string()),
        port: fields.get("port").and_then(|v| v.parse().ok()),
        database: fields.get("dbname").map(|v| v.to_string()),
        user: fields.get("user").map(|v| v.to_string()),
        ssl_mode: SslMode::Prefer,
    };
    Some((config, fields.get("password").map(|v| v.to_string())))
}

const SETUP: &str = "
    DROP TABLE IF EXISTS graft_it_orders;
    DROP TABLE IF EXISTS graft_it_users;
    CREATE TABLE graft_it_users (id INT PRIMARY KEY, name VARCHAR(40) NOT NULL, active BOOLEAN);
    CREATE TABLE graft_it_orders (
        id INT PRIMARY KEY,
        user_id INT NOT NULL REFERENCES graft_it_users (id),
        total DECIMAL(10, 2)
    );
    INSERT INTO graft_it_users VALUES (1, 'ada', TRUE), (2, 'linus', FALSE), (3, 'grace', TRUE);
    INSERT INTO graft_it_orders VALUES (10, 1, 12.50), (11, 1, 3.00);
";
const TEARDOWN: &str = "DROP TABLE graft_it_orders; DROP TABLE graft_it_users;";

/// Index, view, trigger and routine, in each engine's dialect.
fn objects_script(engine: Engine) -> &'static str {
    match engine {
        Engine::Postgres => "
            CREATE INDEX graft_it_orders_user ON graft_it_orders (user_id);
            CREATE VIEW graft_it_big AS SELECT * FROM graft_it_orders WHERE total > 10;
            CREATE FUNCTION graft_it_touch() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN NEW.total := COALESCE(NEW.total, 0); RETURN NEW; END $$;
            CREATE TRIGGER graft_it_orders_touch BEFORE INSERT OR UPDATE ON graft_it_orders
              FOR EACH ROW EXECUTE FUNCTION graft_it_touch();
            CREATE PROCEDURE graft_it_reset(target integer) LANGUAGE sql AS
              $$ UPDATE graft_it_orders SET total = 0 WHERE id = target $$;
        ",
        _ => "
            CREATE INDEX graft_it_orders_user ON graft_it_orders (user_id);
            CREATE VIEW graft_it_big AS SELECT * FROM graft_it_orders WHERE total > 10;
            CREATE TRIGGER graft_it_orders_touch BEFORE INSERT ON graft_it_orders
              FOR EACH ROW SET NEW.total = COALESCE(NEW.total, 0);
            CREATE PROCEDURE graft_it_reset(IN target INT)
            BEGIN UPDATE graft_it_orders SET total = 0 WHERE id = target; END;
        ",
    }
}

fn drop_objects_script(engine: Engine) -> &'static str {
    match engine {
        Engine::Postgres => "
            DROP VIEW graft_it_big;
            DROP TRIGGER graft_it_orders_touch ON graft_it_orders;
            DROP FUNCTION graft_it_touch();
            DROP PROCEDURE graft_it_reset(integer);
        ",
        _ => "
            DROP VIEW graft_it_big;
            DROP TRIGGER graft_it_orders_touch;
            DROP PROCEDURE graft_it_reset;
        ",
    }
}

async fn exercise(config: ConnectionConfig, password: Option<String>) {
    let password = password.as_deref();
    let databases = Databases::default();
    assert!(!test_connection(&config, password).await.unwrap().is_empty());

    // A multi-statement script runs in one go.
    let setup = databases.execute(&config, password, SETUP, 100).await.unwrap();
    assert!(setup.rows_affected >= 5, "rows affected: {}", setup.rows_affected);

    // Text-protocol values come back typed; the cap keeps the true total.
    let select = "SELECT u.id, u.name, u.active, o.total FROM graft_it_users u \
                  LEFT JOIN graft_it_orders o ON o.user_id = u.id ORDER BY u.id, o.id";
    let result = databases.execute(&config, password, select, 2).await.unwrap();
    assert_eq!(result.columns, vec!["id", "name", "active", "total"]);
    assert_eq!(result.rows.len(), 2);
    assert_eq!(result.total_rows, 4);
    assert!(result.truncated);
    assert_eq!(result.rows[0][0], serde_json::json!(1));
    assert_eq!(result.rows[0][1], serde_json::json!("ada"));
    assert_eq!(result.rows[0][3], serde_json::json!(12.5));

    databases
        .execute(&config, password, objects_script(config.engine), 10)
        .await
        .unwrap();
    let schema = databases.introspect(&config, password).await.unwrap();
    let orders = schema
        .tables
        .iter()
        .find(|t| t.name == "graft_it_orders")
        .expect("orders table introspected");
    assert!(orders.columns.iter().any(|c| c.name == "id" && c.pk));
    assert!(orders.columns.iter().any(|c| c.name == "user_id" && c.notnull));
    assert_eq!(orders.foreign_keys.len(), 1);
    assert_eq!(orders.foreign_keys[0].to_table, "graft_it_users");
    assert_eq!(orders.foreign_keys[0].to_column, "id");
    assert!(orders.indexes.iter().any(|i| i.primary && i.columns == ["id"]));
    assert!(orders
        .indexes
        .iter()
        .any(|i| i.name == "graft_it_orders_user" && !i.unique && i.columns == ["user_id"]));
    let view = schema.tables.iter().find(|t| t.name == "graft_it_big").expect("view");
    assert_eq!(view.kind, "view");
    assert!(view.definition.as_deref().unwrap_or("").contains("10"));
    let trigger = schema
        .triggers
        .iter()
        .find(|t| t.name == "graft_it_orders_touch")
        .expect("trigger introspected");
    assert_eq!(trigger.table, "graft_it_orders");
    assert_eq!(trigger.timing, "BEFORE");
    assert!(trigger.events.contains("INSERT"));
    let procedure = schema
        .routines
        .iter()
        .find(|r| r.name == "graft_it_reset")
        .expect("procedure introspected");
    assert_eq!(procedure.kind, "procedure");
    assert!(procedure.arguments.contains("target"), "{}", procedure.arguments);
    assert!(procedure.definition.to_ascii_uppercase().contains("UPDATE"));
    if config.engine == Engine::Postgres {
        let function = schema.routines.iter().find(|r| r.name == "graft_it_touch").expect("function");
        assert_eq!(function.kind, "function");
        assert_eq!(function.returns.as_deref(), Some("trigger"));
    }
    databases
        .execute(&config, password, drop_objects_script(config.engine), 10)
        .await
        .unwrap();

    let error = databases
        .execute(&config, password, "SELECT id FROM graft_it_users WHER id = 1", 10)
        .await
        .err()
        .expect("syntax error");
    if config.engine == Engine::Postgres {
        assert_eq!(error.position, Some("SELECT id FROM graft_it_users WHER ".len()));
    } else {
        assert!(error.message.contains("near 'id = 1'"), "{}", error.message);
    }

    databases.execute(&config, password, TEARDOWN, 10).await.unwrap();

    let wrong = test_connection(&config, Some("definitely-not-the-password")).await;
    assert!(wrong.is_err(), "a wrong password must be rejected");
}

#[tokio::test]
async fn postgres_end_to_end() {
    match from_env(POSTGRES_ENV, Engine::Postgres) {
        Some((config, password)) => exercise(config, password).await,
        None => eprintln!("skipped: set {POSTGRES_ENV} to run against a Postgres server"),
    }
}

#[tokio::test]
async fn mysql_end_to_end() {
    match from_env(MYSQL_ENV, Engine::Mysql) {
        Some((config, password)) => exercise(config, password).await,
        None => eprintln!("skipped: set {MYSQL_ENV} to run against a MySQL server"),
    }
}
