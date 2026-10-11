//! Thin, typed SQL bridge between the TypeScript repository layer and SQLite.
//!
//! All domain logic (schema, migrations, queries) lives in `src/data/` on the
//! TypeScript side so it can be unit-tested against the same SQL in Node. This
//! module only binds JSON parameters, executes statements, and serialises rows.

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Db {
    pub conn: Mutex<Connection>,
    pub path: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct Stmt {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub changes: usize,
    pub last_insert_rowid: i64,
}

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(err)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(err)?;
    Ok(conn)
}

fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn from_sql(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::Array(b.iter().map(|x| Value::from(*x)).collect()),
    }
}

pub fn select(conn: &Connection, sql: &str, params: &[Value]) -> Result<Vec<Map<String, Value>>, String> {
    let mut stmt = conn.prepare_cached(sql).map_err(err)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(params.iter().map(to_sql))).map_err(err)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(err)? {
        let mut m = Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            m.insert(name.clone(), from_sql(row.get_ref(i).map_err(err)?));
        }
        out.push(m);
    }
    Ok(out)
}

pub fn execute(conn: &Connection, sql: &str, params: &[Value]) -> Result<ExecResult, String> {
    let mut stmt = conn.prepare_cached(sql).map_err(err)?;
    let changes = stmt.execute(params_from_iter(params.iter().map(to_sql))).map_err(err)?;
    Ok(ExecResult { changes, last_insert_rowid: conn.last_insert_rowid() })
}

/// Executes every statement inside one transaction; any failure rolls back all of them.
pub fn batch(conn: &mut Connection, stmts: &[Stmt]) -> Result<usize, String> {
    let tx = conn.transaction().map_err(err)?;
    let mut total = 0usize;
    for (idx, s) in stmts.iter().enumerate() {
        let mut stmt = tx.prepare_cached(&s.sql).map_err(|e| format!("statement {idx}: {e}"))?;
        total += stmt
            .execute(params_from_iter(s.params.iter().map(to_sql)))
            .map_err(|e| format!("statement {idx}: {e}"))?;
    }
    tx.commit().map_err(err)?;
    Ok(total)
}

/// Consistent point-in-time copy of the database (safe while the app is running).
pub fn snapshot(conn: &Connection, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        std::fs::remove_file(dest).map_err(err)?;
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(err)?;
    }
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().to_string()]).map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn roundtrip_types_and_batch_rollback() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = open(&dir.path().join("t.db")).unwrap();
        conn.execute_batch("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, r REAL, s TEXT)").unwrap();
        execute(&conn, "INSERT INTO t VALUES (?,?,?,?)", &[json!("a"), json!(3), json!(1.5), json!("ε → \\varepsilon")]).unwrap();
        let rows = select(&conn, "SELECT * FROM t", &[]).unwrap();
        assert_eq!(rows[0]["n"], json!(3));
        assert_eq!(rows[0]["r"], json!(1.5));
        assert_eq!(rows[0]["s"], json!("ε → \\varepsilon"));

        // Second statement violates the primary key: the whole batch must roll back.
        let res = batch(
            &mut conn,
            &[
                Stmt { sql: "INSERT INTO t (id) VALUES ('b')".into(), params: vec![] },
                Stmt { sql: "INSERT INTO t (id) VALUES ('a')".into(), params: vec![] },
            ],
        );
        assert!(res.is_err());
        let rows = select(&conn, "SELECT COUNT(*) AS c FROM t", &[]).unwrap();
        assert_eq!(rows[0]["c"], json!(1));
    }

    #[test]
    fn snapshot_is_readable() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&dir.path().join("a.db")).unwrap();
        conn.execute_batch("CREATE TABLE x (v TEXT); INSERT INTO x VALUES ('kept');").unwrap();
        let dest = dir.path().join("backups").join("snap.db");
        snapshot(&conn, &dest).unwrap();
        let copy = Connection::open(&dest).unwrap();
        let v: String = copy.query_row("SELECT v FROM x", [], |r| r.get(0)).unwrap();
        assert_eq!(v, "kept");
    }

    #[test]
    fn fts4_available() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE VIRTUAL TABLE f USING fts4(pid, body, notindexed=pid, tokenize=unicode61 'remove_diacritics=2');
             INSERT INTO f VALUES ('p1', 'Suites de Cauchy et séquences');",
        )
        .unwrap();
        let rows = select(&conn, "SELECT pid FROM f WHERE f MATCH 'sequ*'", &[]).unwrap();
        assert_eq!(rows.len(), 1);
    }
}
